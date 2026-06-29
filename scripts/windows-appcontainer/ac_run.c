/*
 * ac_run.c - run a command inside a Windows AppContainer (lowbox token).
 *
 *   clang-cl /O1 ac_run.c /Fe:ac_run.exe
 *
 * usage:
 *   ac_run.exe [--name N] [--caps a,b,c | --nocaps] [--cwd DIR] [--timeout SEC]
 *              [--show-sid] [--lpac] [--quiet] -- prog args...
 *
 *  - creates (or reuses) an AppContainer profile named N (default "bun.ac.dev")
 *  - default capabilities: internetClient,internetClientServer,privateNetworkClientServer
 *  - grants the container SID access to the current window station + desktop
 *    (required in non-interactive sessions, or user32.dll init fails: 0xC0000142)
 *  - child runs inside a kill-on-close job; stdio handles are inherited
 *  - exit code: the child's (124 on timeout, 120 on launcher error)
 */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <userenv.h>
#include <sddl.h>
#include <aclapi.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#pragma comment(lib, "userenv.lib")
#pragma comment(lib, "advapi32.lib")
#pragma comment(lib, "user32.lib")

static void die(const char *what) {
  DWORD e = GetLastError();
  fprintf(stderr, "[ac_run] FATAL: %s (gle=%lu)\n", what, e);
  exit(120);
}

typedef struct { const wchar_t *name; WELL_KNOWN_SID_TYPE type; } CapMap;
static const CapMap k_caps[] = {
  {L"internetClient",             WinCapabilityInternetClientSid},
  {L"internetClientServer",       WinCapabilityInternetClientServerSid},
  {L"privateNetworkClientServer", WinCapabilityPrivateNetworkClientServerSid},
  {L"documentsLibrary",           WinCapabilityDocumentsLibrarySid},
  {L"picturesLibrary",            WinCapabilityPicturesLibrarySid},
  {L"videosLibrary",              WinCapabilityVideosLibrarySid},
  {L"musicLibrary",               WinCapabilityMusicLibrarySid},
  {L"enterpriseAuthentication",   WinCapabilityEnterpriseAuthenticationSid},
  {L"sharedUserCertificates",     WinCapabilitySharedUserCertificatesSid},
  {L"removableStorage",           WinCapabilityRemovableStorageSid},
};

typedef BOOL (WINAPI *DeriveCapabilitySidsFromName_t)(LPCWSTR, PSID**, DWORD*, PSID**, DWORD*);

static PSID cap_sid(const wchar_t *name) {
  size_t j;
  for (j = 0; j < sizeof(k_caps)/sizeof(k_caps[0]); j++) {
    if (_wcsicmp(name, k_caps[j].name) == 0) {
      DWORD cb = SECURITY_MAX_SID_SIZE;
      PSID s = (PSID)LocalAlloc(LMEM_FIXED, cb);
      if (!s || !CreateWellKnownSid(k_caps[j].type, NULL, s, &cb)) die("CreateWellKnownSid");
      return s;
    }
  }
  if (wcsncmp(name, L"S-1-", 4) == 0) {
    PSID s = NULL;
    if (!ConvertStringSidToSidW(name, &s)) die("ConvertStringSidToSid");
    return s;
  }
  {
    DeriveCapabilitySidsFromName_t f = (DeriveCapabilitySidsFromName_t)
        GetProcAddress(GetModuleHandleW(L"kernelbase.dll"), "DeriveCapabilitySidsFromName");
    PSID *gsids = NULL, *sids = NULL; DWORD ng = 0, ns = 0;
    if (!f) die("DeriveCapabilitySidsFromName unavailable");
    if (!f(name, &gsids, &ng, &sids, &ns) || ns < 1) die("DeriveCapabilitySidsFromName");
    return sids[0];
  }
}

/* Add an allow ACE for `sid` to a kernel/window object's DACL. */
static void grant_on_handle(HANDLE h, SE_OBJECT_TYPE type, PSID sid, DWORD mask, const char *what) {
  PACL old_dacl = NULL, new_dacl = NULL;
  PSECURITY_DESCRIPTOR psd = NULL;
  EXPLICIT_ACCESS_W ea;
  DWORD rc = GetSecurityInfo(h, type, DACL_SECURITY_INFORMATION, NULL, NULL, &old_dacl, NULL, &psd);
  if (rc != ERROR_SUCCESS) { fprintf(stderr, "[ac_run] warn: GetSecurityInfo(%s) rc=%lu\n", what, rc); return; }
  ZeroMemory(&ea, sizeof ea);
  ea.grfAccessPermissions = mask;
  ea.grfAccessMode = GRANT_ACCESS;
  ea.grfInheritance = NO_INHERITANCE;
  ea.Trustee.TrusteeForm = TRUSTEE_IS_SID;
  ea.Trustee.TrusteeType = TRUSTEE_IS_GROUP;
  ea.Trustee.ptstrName = (LPWSTR)sid;
  rc = SetEntriesInAclW(1, &ea, old_dacl, &new_dacl);
  if (rc == ERROR_SUCCESS) {
    rc = SetSecurityInfo(h, type, DACL_SECURITY_INFORMATION, NULL, NULL, new_dacl, NULL);
    if (rc != ERROR_SUCCESS) fprintf(stderr, "[ac_run] warn: SetSecurityInfo(%s) rc=%lu\n", what, rc);
  } else fprintf(stderr, "[ac_run] warn: SetEntriesInAcl(%s) rc=%lu\n", what, rc);
  if (new_dacl) LocalFree(new_dacl);
  if (psd) LocalFree(psd);
}

static void append_quoted(wchar_t *dst, size_t cap, const wchar_t *a, int add_space) {
  size_t len = wcslen(dst);
#define PUTC(c) do { if (len + 1 < cap) dst[len++] = (c); } while (0)
  if (add_space) PUTC(L' ');
  if (*a && !wcspbrk(a, L" \t\"")) {
    while (*a) { PUTC(*a); a++; }
  } else {
    const wchar_t *p = a;
    PUTC(L'"');
    for (;;) {
      size_t nb = 0, z;
      while (*p == L'\\') { nb++; p++; }
      if (*p == 0)    { for (z = 0; z < nb*2; z++) PUTC(L'\\'); break; }
      if (*p == L'"') { for (z = 0; z < nb*2+1; z++) PUTC(L'\\'); PUTC(L'"'); }
      else            { for (z = 0; z < nb; z++) PUTC(L'\\'); PUTC(*p); }
      p++;
    }
    PUTC(L'"');
  }
  dst[len] = 0;
#undef PUTC
}

#ifndef PROC_THREAD_ATTRIBUTE_ALL_APPLICATION_PACKAGES_POLICY
#define ProcThreadAttributeAllApplicationPackagesPolicy 15
#define PROC_THREAD_ATTRIBUTE_ALL_APPLICATION_PACKAGES_POLICY \
  ProcThreadAttributeValue(ProcThreadAttributeAllApplicationPackagesPolicy, FALSE, TRUE, FALSE)
#endif
#ifndef PROCESS_CREATION_ALL_APPLICATION_PACKAGES_OPT_OUT
#define PROCESS_CREATION_ALL_APPLICATION_PACKAGES_OPT_OUT 1
#endif

int wmain(int argc, wchar_t **argv) {
  const wchar_t *name = L"bun.ac.dev";
  const wchar_t *caps = L"internetClient,internetClientServer,privateNetworkClientServer";
  const wchar_t *cwd = NULL;
  DWORD timeout_ms = 120000;
  int show_sid = 0, lpac = 0, verbose = 1;
  int i = 1, k;
  PSID ac_sid = NULL;
  HRESULT hr;
  LPWSTR sid_str = NULL;
  SID_AND_ATTRIBUTES cap_arr[32]; DWORD cap_count = 0;
  wchar_t caps_buf[2048], *p;
  SECURITY_CAPABILITIES sc;
  SIZE_T al_size = 0;
  int n_attrs;
  LPPROC_THREAD_ATTRIBUTE_LIST al;
  DWORD aap_policy = PROCESS_CREATION_ALL_APPLICATION_PACKAGES_OPT_OUT;
  static wchar_t cmdline[32768];
  HANDLE job, hi, ho, he;
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION jeli;
  STARTUPINFOEXW six;
  PROCESS_INFORMATION pi;
  DWORD w, code = 124;

  for (; i < argc; i++) {
    if (wcscmp(argv[i], L"--") == 0) { i++; break; }
    else if (!wcscmp(argv[i], L"--name") && i+1 < argc) name = argv[++i];
    else if (!wcscmp(argv[i], L"--caps") && i+1 < argc) caps = argv[++i];
    else if (!wcscmp(argv[i], L"--nocaps")) caps = L"";
    else if (!wcscmp(argv[i], L"--cwd") && i+1 < argc) cwd = argv[++i];
    else if (!wcscmp(argv[i], L"--timeout") && i+1 < argc) timeout_ms = (DWORD)(_wtoi(argv[++i]) * 1000);
    else if (!wcscmp(argv[i], L"--show-sid")) show_sid = 1;
    else if (!wcscmp(argv[i], L"--quiet")) verbose = 0;
    else if (!wcscmp(argv[i], L"--lpac")) lpac = 1;
    else { fprintf(stderr, "[ac_run] unknown arg: %ls\n", argv[i]); return 120; }
  }

  hr = CreateAppContainerProfile(name, name, name, NULL, 0, &ac_sid);
  if (FAILED(hr)) {
    if (hr == HRESULT_FROM_WIN32(ERROR_ALREADY_EXISTS))
      hr = DeriveAppContainerSidFromAppContainerName(name, &ac_sid);
    if (FAILED(hr)) { fprintf(stderr, "[ac_run] FATAL: AppContainerProfile hr=0x%lx\n", (unsigned long)hr); return 120; }
  }
  ConvertSidToStringSidW(ac_sid, &sid_str);
  if (show_sid) { printf("%ls\n", sid_str); return 0; }
  if (i >= argc) { fprintf(stderr, "usage: ac_run [--name N] [--caps a,b|--nocaps] [--cwd D] [--timeout S] [--lpac] -- prog args...\n"); return 120; }

  /* user32.dll refuses to initialize in a process that cannot open its window
   * station + desktop; outside an interactive session those objects have no
   * ACE for the container SID, and any exe importing user32 dies with
   * STATUS_DLL_INIT_FAILED (0xC0000142) before main. */
  grant_on_handle((HANDLE)GetProcessWindowStation(), SE_WINDOW_OBJECT, ac_sid, GENERIC_ALL, "winsta");
  grant_on_handle((HANDLE)GetThreadDesktop(GetCurrentThreadId()), SE_WINDOW_OBJECT, ac_sid, GENERIC_ALL, "desktop");

  lstrcpynW(caps_buf, caps, 2048);
  p = caps_buf;
  while (p && *p) {
    wchar_t *comma = wcschr(p, L',');
    if (comma) *comma = 0;
    if (*p) { cap_arr[cap_count].Sid = cap_sid(p); cap_arr[cap_count].Attributes = SE_GROUP_ENABLED; cap_count++; }
    p = comma ? comma + 1 : NULL;
  }

  ZeroMemory(&sc, sizeof sc);
  sc.AppContainerSid = ac_sid;
  sc.Capabilities = cap_count ? cap_arr : NULL;
  sc.CapabilityCount = cap_count;

  n_attrs = lpac ? 2 : 1;
  InitializeProcThreadAttributeList(NULL, n_attrs, 0, &al_size);
  al = (LPPROC_THREAD_ATTRIBUTE_LIST)malloc(al_size);
  if (!al || !InitializeProcThreadAttributeList(al, n_attrs, 0, &al_size)) die("InitializeProcThreadAttributeList");
  if (!UpdateProcThreadAttribute(al, 0, PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, &sc, sizeof sc, NULL, NULL))
    die("UpdateProcThreadAttribute(SECURITY_CAPABILITIES)");
  if (lpac && !UpdateProcThreadAttribute(al, 0, PROC_THREAD_ATTRIBUTE_ALL_APPLICATION_PACKAGES_POLICY, &aap_policy, sizeof aap_policy, NULL, NULL))
    die("UpdateProcThreadAttribute(ALL_APPLICATION_PACKAGES_POLICY)");

  cmdline[0] = 0;
  for (k = i; k < argc; k++) append_quoted(cmdline, 32768, argv[k], k > i);

  if (verbose) fprintf(stderr, "[ac_run] name=%ls sid=%ls lpac=%d caps=%ls\n[ac_run] cmd: %ls\n", name, sid_str, lpac, caps, cmdline);

  job = CreateJobObjectW(NULL, NULL);
  ZeroMemory(&jeli, sizeof jeli);
  jeli.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  SetInformationJobObject(job, JobObjectExtendedLimitInformation, &jeli, sizeof jeli);

  ZeroMemory(&six, sizeof six);
  six.StartupInfo.cb = sizeof six;
  six.lpAttributeList = al;
  six.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
  hi = GetStdHandle(STD_INPUT_HANDLE); ho = GetStdHandle(STD_OUTPUT_HANDLE); he = GetStdHandle(STD_ERROR_HANDLE);
  SetHandleInformation(hi, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);
  SetHandleInformation(ho, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);
  SetHandleInformation(he, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);
  six.StartupInfo.hStdInput = hi; six.StartupInfo.hStdOutput = ho; six.StartupInfo.hStdError = he;

  ZeroMemory(&pi, sizeof pi);
  if (!CreateProcessW(NULL, cmdline, NULL, NULL, TRUE,
                      EXTENDED_STARTUPINFO_PRESENT | CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT,
                      NULL, cwd, &six.StartupInfo, &pi))
    die("CreateProcessW");
  if (!AssignProcessToJobObject(job, pi.hProcess))
    fprintf(stderr, "[ac_run] warn: AssignProcessToJobObject gle=%lu\n", GetLastError());
  ResumeThread(pi.hThread);

  w = WaitForSingleObject(pi.hProcess, timeout_ms);
  if (w == WAIT_TIMEOUT) {
    fprintf(stderr, "[ac_run] TIMEOUT after %lums; killing job\n", timeout_ms);
    TerminateJobObject(job, 124);
    WaitForSingleObject(pi.hProcess, 15000);
    code = 124;
  } else {
    GetExitCodeProcess(pi.hProcess, &code);
  }
  if (verbose) fprintf(stderr, "[ac_run] exit=%ld (0x%lx)\n", (long)code, (unsigned long)code);
  return (int)code;
}
