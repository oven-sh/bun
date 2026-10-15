# Measurements, new base a407eae88a vs PR f9fe4e3a6c (release, linux-x64, gdb single-step / breakpoint counts)
Harness: /tmp/meas (server.ts, setup.ts, run.sh, count_bp.py, step_count.py). Release binaries /tmp/bin-{base,pr}/bun-profile.

## No CA (callers who never hit the bug)
- NetworkTask::manifest_request, one manifest request (bun install and runtime): own code 762 -> 760 instructions, inclusive 12,178 -> 12,181 (+3), calls 34 -> 34.
- generate_network_task_for_tarball (for_tarball inlined): own 697 -> 702, inclusive 11,368 -> 11,378 (+10) for bun install, 10,735 -> 10,745 (+10) at runtime, calls 26 -> 26.
- fetch() https, no TLS options: HTTPClient::start_ -> HttpThread::dial: 104 -> 99 instructions, 3 -> 3 calls. With BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP3_CLIENT=1: 730 -> 746, 7 -> 7 calls.
- ssl_config::global_registry::intern calls with no CA: 0 -> 0.
- SSL_CTX_new / default store loads / cafile reads per process: bun install http 0/0/0 both; runtime http 0/0/0 both; bun install https + NODE_EXTRA_CA_CERTS 1/1/0 both; runtime https + NODE_EXTRA_CA_CERTS (5 packages) 1/1/0 both; runtime, 10 CONNECT tunnels, no CA: 1/1/0 both; fetch https 1/1/0 both.
- bun install + cafile (5 packages, https): 1 SSL_CTX_new, 0 default store loads, 1 SSL_load_client_CA_file, 2 BIO_new_file: same on both.
- struct sizes (debug build DWARF): install Options 688 -> 696, HttpThread 960 -> 960, InternalState 400 -> 400, HTTPClientResult 216 -> 224, HTTPClient 1680 -> 1680, NetworkTask 2800 -> 2808.
- release size: text 106,006,447 -> 106,009,263 (+2,816), data +0, bss +0, file 106,178,312 -> 106,182,408 (+4,096).

## With ca / cafile at runtime (failed before)
- direct https, cafile, 5 packages (10 requests): 2 SSL_CTX_new (default + custom), 1 default store load, 1 SSL_load_client_CA_file, 2 BIO_new_file, 1 intern.
- direct https, ca string: 2 SSL_CTX_new, 1 default store load, 0 file reads, 1 intern.
- direct, registry answers Connection: close (10 connections): same as direct: 2 / 1 / 1.
- HTTPS_PROXY, keep-alive: 1 CONNECT tunnel for 10 requests: 1 SSL_CTX_new, 0 default store loads, 1 cafile read (2 opens).
- HTTPS_PROXY, registry answers Connection: close: 10 tunnels: 10 SSL_CTX_new, 10 cafile reads (20 opens). Without a CA the same 10 tunnels share 1 context.
- missing cafile, imports of 2 names + 1 repeat, all caught: 2 attempts (2 SSL_load_client_CA_file), 0 requests, no retry. Uncaught: 1 `note:` line.
