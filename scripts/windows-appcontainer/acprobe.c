/*
 * acprobe.c - report what win32 primitives do inside/outside an AppContainer.
 * Prints "PROBE <name> <result>" lines. Run it bare for a baseline, then under
 * ac_run.exe for the sandboxed picture.
 *
 *   clang-cl /O1 acprobe.c /Fe:acprobe.exe
 *
 * argv[1] (optional): a 127.0.0.1 port owned by a process OUTSIDE the
 * AppContainer, to test cross-process loopback.
 */
#define WIN32_LEAN_AND_MEAN
#define _CRT_SECURE_NO_WARNINGS
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <sddl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>

#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "advapi32.lib")

#ifndef AF_UNIX
#define AF_UNIX 1
#endif

static void P(const char *k, const char *fmt, ...) {
  va_list ap;
  printf("PROBE %-26s ", k);
  va_start(ap, fmt); vprintf(fmt, ap); va_end(ap);
  printf("\n"); fflush(stdout);
}
static const char *gle(void) { static char b[64]; sprintf(b, "gle=%lu", GetLastError()); return b; }

int main(int argc, char **argv) {
  HANDLE tok = NULL, h;
  DWORD isac = 0, rl = 0, mode;
  BYTE ilbuf[256], acbuf[256];
  char pn[256], cwd[MAX_PATH], fp[1024], qd[512], tp[MAX_PATH], tf[MAX_PATH];
  char un[256], cn[256], env1[512];
  DWORD uns = sizeof un, cns = sizeof cn, n1;
  WIN32_FIND_DATAA fd;
  HANDLE fh;
  HKEY k;
  WSADATA wd;
  int j;

  /* ---- token ---- */
  OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &tok);
  if (GetTokenInformation(tok, TokenIsAppContainer, &isac, sizeof isac, &rl)) P("token.isAppContainer", "%lu", isac);
  else P("token.isAppContainer", "ERR %s", gle());
  rl = 0;
  if (GetTokenInformation(tok, TokenIntegrityLevel, ilbuf, sizeof ilbuf, &rl)) {
    TOKEN_MANDATORY_LABEL *tml = (TOKEN_MANDATORY_LABEL*)ilbuf;
    DWORD n = *GetSidSubAuthorityCount(tml->Label.Sid);
    P("token.integrityRID", "0x%lx", *GetSidSubAuthority(tml->Label.Sid, n - 1));
  }
  rl = 0;
  if (GetTokenInformation(tok, TokenAppContainerSid, acbuf, sizeof acbuf, &rl)) {
    TOKEN_APPCONTAINER_INFORMATION *ti = (TOKEN_APPCONTAINER_INFORMATION*)acbuf;
    if (ti->TokenAppContainer) { LPSTR s = NULL; ConvertSidToStringSidA(ti->TokenAppContainer, &s); P("token.acsid", "%s", s); }
    else P("token.acsid", "(none)");
  }

  /* ---- named pipes ---- */
  sprintf(pn, "\\\\.\\pipe\\acprobe-%lu", GetCurrentProcessId());
  h = CreateNamedPipeA(pn, PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE, PIPE_TYPE_BYTE, 1, 4096, 4096, 0, NULL);
  if (h != INVALID_HANDLE_VALUE) { P("pipe.create.default", "OK %s", pn); CloseHandle(h); }
  else P("pipe.create.default", "ERR %s (%s)", gle(), pn);
  sprintf(pn, "\\\\.\\pipe\\LOCAL\\acprobe-%lu", GetCurrentProcessId());
  h = CreateNamedPipeA(pn, PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE, PIPE_TYPE_BYTE, 1, 4096, 4096, 0, NULL);
  if (h != INVALID_HANDLE_VALUE) { P("pipe.create.LOCAL", "OK %s", pn); CloseHandle(h); }
  else P("pipe.create.LOCAL", "ERR %s (%s)", gle(), pn);
  {
    HANDLE r0, w0;
    if (CreatePipe(&r0, &w0, NULL, 0)) { P("pipe.anonymous", "OK"); CloseHandle(r0); CloseHandle(w0); }
    else P("pipe.anonymous", "ERR %s", gle());
  }

  /* ---- file + final path ---- */
  GetCurrentDirectoryA(MAX_PATH, cwd); P("cwd", "%s", cwd);
  h = CreateFileA("acprobe_tmp.txt", GENERIC_READ | GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
  if (h == INVALID_HANDLE_VALUE) P("file.create.cwd", "ERR %s", gle());
  else { P("file.create.cwd", "OK"); CloseHandle(h); }
  /* GetFinalPathNameByHandle matrix: relative/absolute x file/dir, DOS/NT/NONE */
  {
    char absf[MAX_PATH], absd[MAX_PATH];
    HANDLE hs[4]; const char *names[4];
    sprintf(absf, "%s\\acprobe_tmp.txt", cwd); sprintf(absd, "%s", cwd);
    hs[0] = CreateFileA("acprobe_tmp.txt", GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, 0, NULL); names[0] = "relfile";
    hs[1] = CreateFileA(absf, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, 0, NULL); names[1] = "absfile";
    hs[2] = CreateFileA(".", GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, NULL); names[2] = "reldir";
    hs[3] = CreateFileA(absd, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, NULL); names[3] = "absdir";
    for (j = 0; j < 4; j++) {
      char key[64]; DWORD rc; int k2;
      static const struct { DWORD f; const char *n; } F[3] = { {0, "DOS"}, {2, "NT"}, {4, "NONE"} };
      if (hs[j] == INVALID_HANDLE_VALUE) { sprintf(key, "fp.%s", names[j]); P(key, "OPEN ERR %s", gle()); continue; }
      for (k2 = 0; k2 < 3; k2++) {
        sprintf(key, "fp.%s.%s", names[j], F[k2].n);
        rc = GetFinalPathNameByHandleA(hs[j], fp, sizeof fp, F[k2].f);
        if (rc > 0 && rc < sizeof fp) P(key, "OK %s", fp); else P(key, "ERR %s", gle());
      }
      CloseHandle(hs[j]);
    }
  }
  if (QueryDosDeviceA("C:", qd, sizeof qd)) P("QueryDosDevice.C", "OK %s", qd); else P("QueryDosDevice.C", "ERR %s", gle());
  {
    DWORD mask = GetLogicalDrives(); int mapped = 0, total = 0; char dl[3] = "A:";
    for (j = 0; j < 26; j++) if (mask & (1u << j)) { total++; dl[0] = (char)('A' + j); if (QueryDosDeviceA(dl, qd, sizeof qd)) mapped++; }
    P("QueryDosDevice.all", "%d/%d (GetLogicalDrives=0x%lx)", mapped, total, mask);
  }

  /* ---- volume identity without the mount manager ---- */
  {
    char vn[128], fsn[64]; DWORD serial = 0, mcl = 0, fl = 0;
    if (GetVolumeInformationA("C:\\", vn, sizeof vn, &serial, &mcl, &fl, fsn, sizeof fsn)) P("GetVolumeInfo.Croot", "OK serial=%08lx fs=%s", serial, fsn);
    else P("GetVolumeInfo.Croot", "ERR %s", gle());
    P("GetDriveType.Croot", "%lu", GetDriveTypeA("C:\\"));
    h = CreateFileA("volprobe.txt", GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_FLAG_DELETE_ON_CLOSE, NULL);
    if (h != INVALID_HANDLE_VALUE) {
      BY_HANDLE_FILE_INFORMATION bi;
      if (GetFileInformationByHandle(h, &bi)) P("VolSerialByHandle.cwd", "OK %08lx", bi.dwVolumeSerialNumber); else P("VolSerialByHandle.cwd", "ERR %s", gle());
      CloseHandle(h);
    } else P("VolSerialByHandle.cwd", "ERR open %s", gle());
  }
  /* ---- special device names ---- */
  h = CreateFileA("NUL", GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_EXISTING, 0, NULL);
  if (h != INVALID_HANDLE_VALUE) { P("open.NUL", "OK"); CloseHandle(h); } else P("open.NUL", "ERR %s", gle());
  h = CreateFileA("CONOUT$", GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_EXISTING, 0, NULL);
  if (h != INVALID_HANDLE_VALUE) { P("open.CONOUT", "OK"); CloseHandle(h); } else P("open.CONOUT", "ERR %s", gle());

  GetTempPathA(MAX_PATH, tp); P("GetTempPath", "%s", tp);
  sprintf(tf, "%sacprobe_%lu.tmp", tp, GetCurrentProcessId());
  h = CreateFileA(tf, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL | FILE_FLAG_DELETE_ON_CLOSE, NULL);
  if (h != INVALID_HANDLE_VALUE) { P("file.create.TEMP", "OK"); CloseHandle(h); } else P("file.create.TEMP", "ERR %s", gle());
  n1 = GetEnvironmentVariableA("USERPROFILE", env1, sizeof env1);
  sprintf(tf, "%s\\*", n1 ? env1 : "C:\\Users\\Default");
  fh = FindFirstFileA(tf, &fd);
  if (fh != INVALID_HANDLE_VALUE) { P("list.USERPROFILE", "OK"); FindClose(fh); } else P("list.USERPROFILE", "ERR %s", gle());
  fh = FindFirstFileA("C:\\Windows\\System32\\kernel32.dll", &fd);
  if (fh != INVALID_HANDLE_VALUE) { P("stat.system32", "OK"); FindClose(fh); } else P("stat.system32", "ERR %s", gle());

  /* ---- links (in cwd) ---- */
  h = CreateFileA("acprobe_tmp.txt", GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
  if (h != INVALID_HANDLE_VALUE) CloseHandle(h);
  if (CreateSymbolicLinkA("acprobe_sym.txt", "acprobe_tmp.txt", 0)) P("symlink.plain", "OK"); else P("symlink.plain", "ERR %s", gle());
  if (CreateSymbolicLinkA("acprobe_sym2.txt", "acprobe_tmp.txt", 0x2)) P("symlink.unpriv", "OK"); else P("symlink.unpriv", "ERR %s", gle());
  if (CreateHardLinkA("acprobe_hard.txt", "acprobe_tmp.txt", NULL)) P("hardlink", "OK"); else P("hardlink", "ERR %s", gle());
  DeleteFileA("acprobe_sym.txt"); DeleteFileA("acprobe_sym2.txt"); DeleteFileA("acprobe_hard.txt"); DeleteFileA("acprobe_tmp.txt");

  /* ---- registry ---- */
  if (RegOpenKeyExA(HKEY_LOCAL_MACHINE, "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion", 0, KEY_READ, &k) == 0) {
    char v[256]; DWORD cb = sizeof v;
    if (RegQueryValueExA(k, "CurrentBuildNumber", NULL, NULL, (BYTE*)v, &cb) != 0) strcpy(v, "?");
    P("reg.HKLM.CurrentVersion", "OK build=%s", v); RegCloseKey(k);
  } else P("reg.HKLM.CurrentVersion", "ERR");
  if (RegOpenKeyExA(HKEY_LOCAL_MACHINE, "HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0", 0, KEY_READ, &k) == 0) { P("reg.HKLM.cpu0", "OK"); RegCloseKey(k); }
  else P("reg.HKLM.cpu0", "ERR");
  if (RegOpenKeyExA(HKEY_CURRENT_USER, "Environment", 0, KEY_READ, &k) == 0) { P("reg.HKCU.Environment", "OK"); RegCloseKey(k); }
  else P("reg.HKCU.Environment", "ERR");

  /* ---- identity ---- */
  if (GetUserNameA(un, &uns)) P("GetUserName", "OK %s", un); else P("GetUserName", "ERR %s", gle());
  if (GetComputerNameA(cn, &cns)) P("GetComputerName", "OK %s", cn); else P("GetComputerName", "ERR %s", gle());
  n1 = GetEnvironmentVariableA("USERPROFILE", env1, sizeof env1); P("env.USERPROFILE", "%s", n1 ? env1 : "(unset)");
  n1 = GetEnvironmentVariableA("TEMP", env1, sizeof env1); P("env.TEMP", "%s", n1 ? env1 : "(unset)");

  /* ---- ConPTY ---- */
  {
    HANDLE ir, iw, outr, outw; HPCON hpc; COORD sz; HRESULT hrr;
    sz.X = 80; sz.Y = 25;
    CreatePipe(&ir, &iw, NULL, 0); CreatePipe(&outr, &outw, NULL, 0);
    hrr = CreatePseudoConsole(sz, ir, outw, 0, &hpc);
    if (hrr == S_OK) { P("ConPTY.create", "OK"); ClosePseudoConsole(hpc); } else P("ConPTY.create", "ERR 0x%lx", (unsigned long)hrr);
    CloseHandle(ir); CloseHandle(iw); CloseHandle(outr); CloseHandle(outw);
  }

  /* ---- network ---- */
  WSAStartup(MAKEWORD(2,2), &wd);
  {
    struct addrinfo hints, *res = NULL; int ga;
    memset(&hints, 0, sizeof hints); hints.ai_family = AF_INET; hints.ai_socktype = SOCK_STREAM;
    ga = getaddrinfo("example.com", "443", &hints, &res);
    if (ga == 0 && res) { char ip[64]; getnameinfo(res->ai_addr, (int)res->ai_addrlen, ip, sizeof ip, NULL, 0, NI_NUMERICHOST); P("dns.getaddrinfo", "OK %s", ip); freeaddrinfo(res); }
    else P("dns.getaddrinfo", "ERR %d", ga);
  }
  {
    SOCKET s = socket(AF_INET, SOCK_STREAM, 0); struct sockaddr_in a; u_long nb = 1;
    fd_set wf, ef; struct timeval tv; int sr, soe = 0, sl = 4;
    memset(&a, 0, sizeof a); a.sin_family = AF_INET; a.sin_port = htons(443); a.sin_addr.s_addr = inet_addr("1.1.1.1");
    ioctlsocket(s, FIONBIO, &nb); connect(s, (struct sockaddr*)&a, sizeof a);
    FD_ZERO(&wf); FD_ZERO(&ef); FD_SET(s, &wf); FD_SET(s, &ef); tv.tv_sec = 7; tv.tv_usec = 0;
    sr = select(0, NULL, &wf, &ef, &tv);
    if (sr > 0 && FD_ISSET(s, &wf)) P("tcp.connect.internet", "OK 1.1.1.1:443");
    else { getsockopt(s, SOL_SOCKET, SO_ERROR, (char*)&soe, &sl); P("tcp.connect.internet", "ERR sel=%d soerr=%d", sr, soe); }
    closesocket(s);
  }
  {
    SOCKET ls = socket(AF_INET, SOCK_STREAM, 0); struct sockaddr_in a; int alen = sizeof a;
    memset(&a, 0, sizeof a); a.sin_family = AF_INET; a.sin_port = 0; a.sin_addr.s_addr = inet_addr("127.0.0.1");
    if (bind(ls, (struct sockaddr*)&a, sizeof a) == 0 && listen(ls, 1) == 0) {
      SOCKET cs; u_long nb = 1; fd_set wf, ef; struct timeval tv; int sr, soe = 0, sl = 4;
      getsockname(ls, (struct sockaddr*)&a, &alen);
      P("tcp.listen.127", "OK port=%d", ntohs(a.sin_port));
      cs = socket(AF_INET, SOCK_STREAM, 0);
      ioctlsocket(cs, FIONBIO, &nb); connect(cs, (struct sockaddr*)&a, sizeof a);
      FD_ZERO(&wf); FD_ZERO(&ef); FD_SET(cs, &wf); FD_SET(cs, &ef); tv.tv_sec = 5; tv.tv_usec = 0;
      sr = select(0, NULL, &wf, &ef, &tv);
      if (sr > 0 && FD_ISSET(cs, &wf)) P("tcp.selfloopback", "OK");
      else { getsockopt(cs, SOL_SOCKET, SO_ERROR, (char*)&soe, &sl); P("tcp.selfloopback", "ERR sel=%d soerr=%d", sr, soe); }
      closesocket(cs);
    } else P("tcp.listen.127", "ERR %d", WSAGetLastError());
    closesocket(ls);
  }
  if (argc >= 2) {
    SOCKET s = socket(AF_INET, SOCK_STREAM, 0); struct sockaddr_in a; u_long nb = 1;
    fd_set wf, ef; struct timeval tv; int sr, soe = 0, sl = 4, port = atoi(argv[1]);
    memset(&a, 0, sizeof a); a.sin_family = AF_INET; a.sin_port = htons((u_short)port); a.sin_addr.s_addr = inet_addr("127.0.0.1");
    ioctlsocket(s, FIONBIO, &nb); connect(s, (struct sockaddr*)&a, sizeof a);
    FD_ZERO(&wf); FD_ZERO(&ef); FD_SET(s, &wf); FD_SET(s, &ef); tv.tv_sec = 5; tv.tv_usec = 0;
    sr = select(0, NULL, &wf, &ef, &tv);
    if (sr > 0 && FD_ISSET(s, &wf)) P("tcp.crossloopback", "OK port=%d", port);
    else { getsockopt(s, SOL_SOCKET, SO_ERROR, (char*)&soe, &sl); P("tcp.crossloopback", "ERR sel=%d soerr=%d port=%d", sr, soe, port); }
    closesocket(s);
  }
  {
    SOCKET us = socket(AF_UNIX, SOCK_STREAM, 0);
    if (us == INVALID_SOCKET) P("unix.socket", "ERR %d", WSAGetLastError());
    else {
      struct { unsigned short f; char p[108]; } ua;
      memset(&ua, 0, sizeof ua); ua.f = AF_UNIX; strcpy(ua.p, "acprobe.sock"); DeleteFileA("acprobe.sock");
      if (bind(us, (struct sockaddr*)&ua, sizeof ua) == 0) P("unix.bind.cwd", "OK"); else P("unix.bind.cwd", "ERR %d", WSAGetLastError());
      closesocket(us); DeleteFileA("acprobe.sock");
    }
  }

  /* ---- spawn ---- */
  {
    STARTUPINFOA si; PROCESS_INFORMATION pi; char cl[] = "cmd.exe /c exit 42"; DWORD ec = 0;
    memset(&si, 0, sizeof si); si.cb = sizeof si;
    if (CreateProcessA(NULL, cl, NULL, NULL, FALSE, CREATE_NO_WINDOW, NULL, NULL, &si, &pi)) {
      WaitForSingleObject(pi.hProcess, 15000); GetExitCodeProcess(pi.hProcess, &ec);
      P("spawn.cmd", "OK exit=%lu", ec);
      CloseHandle(pi.hProcess); CloseHandle(pi.hThread);
    } else P("spawn.cmd", "ERR %s", gle());
  }
  {
    HANDLE op = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, 4);
    if (op) { P("OpenProcess.pid4", "OK (!)"); CloseHandle(op); } else P("OpenProcess.pid4", "ERR %s", gle());
  }

  /* ---- console ---- */
  P("GetConsoleMode.stdout", "%s", GetConsoleMode(GetStdHandle(STD_OUTPUT_HANDLE), &mode) ? "console" : "not-console");
  P("GetFileType.stdout", "%lu", GetFileType(GetStdHandle(STD_OUTPUT_HANDLE)));
  P("done", "ok");
  return 0;
}
