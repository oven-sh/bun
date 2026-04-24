/**
 * c-ares — async DNS resolver. Backs node:dns and the Happy Eyeballs logic
 * in bun's HTTP client. Async is the point — libc's getaddrinfo blocks.
 *
 * DirectBuild: cmake's configure step runs ~130 try_compile probes to fill
 * ares_config.h (libc function/header presence + the exact prototypes of
 * recv/send/recvfrom for the casts in ares_socket.c). We pin those answers
 * per target instead.
 */

import type { Config } from "../config.ts";
import type { Dependency } from "../source.ts";
import { depBuildDir } from "../source.ts";

const CARES_COMMIT = "3ac47ee46edd8ea40370222f91613fc16c434853";

// prettier-ignore
const SOURCES = [
  "ares_addrinfo2hostent", "ares_addrinfo_localhost", "ares_android",
  "ares_cancel", "ares_close_sockets", "ares_conn", "ares_cookie", "ares_data",
  "ares_destroy", "ares_free_hostent", "ares_free_string", "ares_freeaddrinfo",
  "ares_getaddrinfo", "ares_getenv", "ares_gethostbyaddr", "ares_gethostbyname",
  "ares_getnameinfo", "ares_hosts_file", "ares_init", "ares_library_init",
  "ares_metrics", "ares_options", "ares_parse_into_addrinfo", "ares_process",
  "ares_qcache", "ares_query", "ares_search", "ares_send",
  "ares_set_socket_functions", "ares_socket", "ares_sortaddrinfo",
  "ares_strerror", "ares_sysconfig", "ares_sysconfig_files", "ares_sysconfig_mac",
  "ares_sysconfig_win", "ares_timeout", "ares_update_servers", "ares_version",
  "inet_net_pton", "inet_ntop", "windows_port",
  "dsa/ares_array", "dsa/ares_htable", "dsa/ares_htable_asvp",
  "dsa/ares_htable_dict", "dsa/ares_htable_strvp", "dsa/ares_htable_szvp",
  "dsa/ares_htable_vpstr", "dsa/ares_htable_vpvp", "dsa/ares_llist",
  "dsa/ares_slist",
  "event/ares_event_configchg", "event/ares_event_epoll",
  "event/ares_event_kqueue", "event/ares_event_poll", "event/ares_event_select",
  "event/ares_event_thread", "event/ares_event_wake_pipe", "event/ares_event_win32",
  "legacy/ares_create_query", "legacy/ares_expand_name", "legacy/ares_expand_string",
  "legacy/ares_fds", "legacy/ares_getsock", "legacy/ares_parse_a_reply",
  "legacy/ares_parse_aaaa_reply", "legacy/ares_parse_caa_reply",
  "legacy/ares_parse_mx_reply", "legacy/ares_parse_naptr_reply",
  "legacy/ares_parse_ns_reply", "legacy/ares_parse_ptr_reply",
  "legacy/ares_parse_soa_reply", "legacy/ares_parse_srv_reply",
  "legacy/ares_parse_txt_reply", "legacy/ares_parse_uri_reply",
  "record/ares_dns_mapping", "record/ares_dns_multistring", "record/ares_dns_name",
  "record/ares_dns_parse", "record/ares_dns_record", "record/ares_dns_write",
  "str/ares_buf", "str/ares_str", "str/ares_strsplit",
  "util/ares_iface_ips", "util/ares_threads", "util/ares_timeval",
  "util/ares_math", "util/ares_rand", "util/ares_uri",
];

export const cares: Dependency = {
  name: "cares",
  versionMacro: "C_ARES",

  source: () => ({
    kind: "github-archive",
    repo: "c-ares/c-ares",
    commit: CARES_COMMIT,
  }),

  build: cfg => ({
    kind: "direct",
    pic: true,
    sources: SOURCES.map(s => `src/lib/${s}.c`),
    includes: ["include", "src/lib", "src/lib/include"],
    defines: {
      HAVE_CONFIG_H: 1,
      CARES_BUILDING_LIBRARY: true,
      ...(cfg.windows && {
        CARES_STATICLIB: true,
        WIN32_LEAN_AND_MEAN: true,
        _CRT_SECURE_NO_DEPRECATE: true,
        _CRT_NONSTDC_NO_DEPRECATE: true,
      }),
      ...(cfg.linux && {
        _GNU_SOURCE: true,
        _POSIX_C_SOURCE: 200809,
        _XOPEN_SOURCE: 700,
      }),
      ...(cfg.darwin && { _DARWIN_C_SOURCE: true }),
    },
    // _WIN32_WINNT must be the hex LITERAL 0x0602, not its decimal value —
    // sdkddkver.h derives NTDDI_VERSION via token paste (`ver##0000`), so
    // `1538##0000` would yield 15380000 instead of 0x06020000. Can't go
    // through DirectBuild.defines (numbers emit decimal).
    ...(cfg.windows && { cflags: ["-D_WIN32_WINNT=0x0602"] }),
    headers: {
      "ares_config.h": configH(cfg),
      "ares_build.h": buildH(cfg),
    },
  }),

  // ares_build.h is generated into the build dir; consumers (bun's bindings,
  // node:dns) include it via <ares.h> → "ares_build.h".
  provides: cfg => ({
    libs: [],
    includes: ["include", depBuildDir(cfg, "cares")],
  }),
};

// ───────────────────────────────────────────────────────────────────────────
// ares_build.h — public, included by ares.h. Sets the socklen_t / ssize_t
// typedefs and pulls in the right system socket header.
// ───────────────────────────────────────────────────────────────────────────

function buildH(cfg: Config): string {
  if (cfg.windows) {
    return `#ifndef __CARES_BUILD_H
#define __CARES_BUILD_H
#define CARES_TYPEOF_ARES_SOCKLEN_T int
#define CARES_TYPEOF_ARES_SSIZE_T __int64
#define CARES_HAVE_WINDOWS_H
#define CARES_HAVE_WS2TCPIP_H
#define CARES_HAVE_WINSOCK2_H
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#endif
`;
  }
  return `#ifndef __CARES_BUILD_H
#define __CARES_BUILD_H
#define CARES_TYPEOF_ARES_SOCKLEN_T socklen_t
#define CARES_TYPEOF_ARES_SSIZE_T ssize_t
#define CARES_HAVE_SYS_TYPES_H
#define CARES_HAVE_SYS_SOCKET_H
#define CARES_HAVE_SYS_SELECT_H
#define CARES_HAVE_ARPA_NAMESER_H
#define CARES_HAVE_ARPA_NAMESER_COMPAT_H
#include <sys/types.h>
#include <sys/socket.h>
#include <sys/select.h>
#endif
`;
}

// ───────────────────────────────────────────────────────────────────────────
// ares_config.h — private, included by every .c via ares_setup.h. Same shape
// as libarchive's: HAVE_* booleans + the recv/send prototype types c-ares
// uses to cast its socket calls.
// ───────────────────────────────────────────────────────────────────────────

const def1 = (names: string[]) => names.map(n => `#define ${n} 1`).join("\n");

// prettier-ignore
const ALWAYS = def1([
  "HAVE_ASSERT_H", "HAVE_ERRNO_H", "HAVE_FCNTL_H", "HAVE_INTTYPES_H",
  "HAVE_LIMITS_H", "HAVE_MEMORY_H", "HAVE_SIGNAL_H", "HAVE_STDBOOL_H",
  "HAVE_STDINT_H", "HAVE_STDLIB_H", "HAVE_STRING_H", "HAVE_TIME_H",
  "HAVE_SYS_STAT_H", "HAVE_SYS_TYPES_H",
  "HAVE_AF_INET6", "HAVE_PF_INET6", "HAVE_LONGLONG",
  "HAVE_CONNECT", "HAVE_FCNTL", "HAVE_FREEADDRINFO", "HAVE_GETADDRINFO",
  "HAVE_GETENV", "HAVE_GETHOSTNAME", "HAVE_GETNAMEINFO", "HAVE_RECV",
  "HAVE_RECVFROM", "HAVE_SEND", "HAVE_SENDTO", "HAVE_SETSOCKOPT", "HAVE_SOCKET",
  "HAVE_STRDUP", "HAVE_STRNLEN", "HAVE_STAT",
  "HAVE_STRUCT_ADDRINFO", "HAVE_STRUCT_IN6_ADDR", "HAVE_STRUCT_SOCKADDR_IN6",
  "HAVE_STRUCT_SOCKADDR_STORAGE", "HAVE_STRUCT_TIMEVAL",
  "HAVE_STRUCT_SOCKADDR_IN6_SIN6_SCOPE_ID",
  "CARES_THREADS",
]);

// prettier-ignore
const POSIX = def1([
  "HAVE_ARPA_INET_H", "HAVE_ARPA_NAMESER_H", "HAVE_ARPA_NAMESER_COMPAT_H",
  "HAVE_DLFCN_H", "HAVE_IFADDRS_H", "HAVE_NETDB_H", "HAVE_NETINET_IN_H",
  "HAVE_NETINET_TCP_H", "HAVE_NET_IF_H", "HAVE_POLL_H", "HAVE_PTHREAD_H",
  "HAVE_STRINGS_H", "HAVE_SYS_IOCTL_H", "HAVE_SYS_PARAM_H", "HAVE_SYS_SELECT_H",
  "HAVE_SYS_SOCKET_H", "HAVE_SYS_TIME_H", "HAVE_SYS_UIO_H", "HAVE_UNISTD_H",
  "HAVE_CLOCK_GETTIME_MONOTONIC", "HAVE_FCNTL_O_NONBLOCK",
  "HAVE_GETIFADDRS", "HAVE_GETTIMEOFDAY", "HAVE_IF_INDEXTONAME",
  "HAVE_IF_NAMETOINDEX", "HAVE_INET_NTOP", "HAVE_INET_PTON",
  "HAVE_IOCTL", "HAVE_IOCTL_FIONBIO", "HAVE_IOCTL_SIOCGIFADDR", "HAVE_MEMMEM",
  "HAVE_PIPE", "HAVE_POLL", "HAVE_STRCASECMP", "HAVE_STRNCASECMP", "HAVE_WRITEV",
]);

// prettier-ignore
const LINUX = def1([
  "HAVE_MALLOC_H", "HAVE_SYS_EPOLL_H", "HAVE_SYS_RANDOM_H",
  "HAVE_EPOLL", "HAVE_GETRANDOM", "HAVE_GETSERVBYPORT_R", "HAVE_GETSERVBYNAME_R",
  "HAVE_MSG_NOSIGNAL", "HAVE_PIPE2",
]);

// prettier-ignore
const DARWIN = def1([
  "HAVE_SYS_EVENT_H", "HAVE_SYS_SOCKIO_H",
  "HAVE_KQUEUE", "HAVE_ARC4RANDOM_BUF",
]);

// prettier-ignore
const WINDOWS = def1([
  "HAVE_IPHLPAPI_H", "HAVE_MSWSOCK_H", "HAVE_NETIOAPI_H", "HAVE_WINDOWS_H",
  "HAVE_WINSOCK2_H", "HAVE_WS2IPDEF_H", "HAVE_WS2TCPIP_H", "HAVE_IO_H",
  "HAVE_CLOSESOCKET", "HAVE_CONVERTINTERFACEINDEXTOLUID",
  "HAVE_CONVERTINTERFACELUIDTONAMEA", "HAVE_GETBESTROUTE2",
  "HAVE_IF_INDEXTONAME", "HAVE_IF_NAMETOINDEX", "HAVE_INET_NTOP", "HAVE_INET_PTON",
  "HAVE_IOCTLSOCKET", "HAVE_IOCTLSOCKET_FIONBIO",
  "HAVE_NOTIFYIPINTERFACECHANGE", "HAVE_REGISTERWAITFORSINGLEOBJECT",
  "HAVE__STRDUP",
]);

// recv/send/recvfrom prototypes — c-ares casts through these to call the
// platform socket API generically. POSIX is uniform; winsock uses SOCKET +
// int lengths and char* buffers.
const POSIX_SOCKET_TYPES = `
#define GETHOSTNAME_TYPE_ARG2 size_t
#define GETSERVBYPORT_R_ARGS 6
#define GETSERVBYNAME_R_ARGS 6
#define RECVFROM_TYPE_ARG1 int
#define RECVFROM_TYPE_ARG2 void *
#define RECVFROM_TYPE_ARG2_IS_VOID 0
#define RECVFROM_TYPE_ARG3 size_t
#define RECVFROM_TYPE_ARG4 int
#define RECVFROM_TYPE_ARG5 struct sockaddr *
#define RECVFROM_TYPE_ARG5_IS_VOID 0
#define RECVFROM_TYPE_ARG6 socklen_t *
#define RECVFROM_TYPE_ARG6_IS_VOID 0
#define RECVFROM_TYPE_RETV ssize_t
#define RECV_TYPE_ARG1 int
#define RECV_TYPE_ARG2 void *
#define RECV_TYPE_ARG3 size_t
#define RECV_TYPE_ARG4 int
#define RECV_TYPE_RETV ssize_t
#define SEND_TYPE_ARG1 int
#define SEND_TYPE_ARG2 const void *
#define SEND_TYPE_ARG3 size_t
#define SEND_TYPE_ARG4 int
#define SEND_TYPE_RETV ssize_t
#define CARES_RANDOM_FILE "/dev/urandom"
`;

const WINDOWS_SOCKET_TYPES = `
#define GETHOSTNAME_TYPE_ARG2 int
#define RECVFROM_TYPE_ARG1 SOCKET
#define RECVFROM_TYPE_ARG2 char *
#define RECVFROM_TYPE_ARG2_IS_VOID 0
#define RECVFROM_TYPE_ARG3 int
#define RECVFROM_TYPE_ARG4 int
#define RECVFROM_TYPE_ARG5 struct sockaddr *
#define RECVFROM_TYPE_ARG5_IS_VOID 0
#define RECVFROM_TYPE_ARG6 int *
#define RECVFROM_TYPE_ARG6_IS_VOID 0
#define RECVFROM_TYPE_RETV int
#define RECV_TYPE_ARG1 SOCKET
#define RECV_TYPE_ARG2 char *
#define RECV_TYPE_ARG3 int
#define RECV_TYPE_ARG4 int
#define RECV_TYPE_RETV int
#define SEND_TYPE_ARG1 SOCKET
#define SEND_TYPE_ARG2 const char *
#define SEND_TYPE_ARG3 int
#define SEND_TYPE_ARG4 int
#define SEND_TYPE_RETV int
`;

function configH(cfg: Config): string {
  let platform: string;
  let types: string;
  if (cfg.windows) {
    platform = WINDOWS;
    types = WINDOWS_SOCKET_TYPES;
  } else {
    platform = `${POSIX}\n${cfg.darwin ? DARWIN : LINUX}`;
    types = POSIX_SOCKET_TYPES;
  }
  return `/* Generated by scripts/build/deps/cares.ts for ${cfg.os}-${cfg.arch} */
${ALWAYS}
${platform}
${types}`;
}
