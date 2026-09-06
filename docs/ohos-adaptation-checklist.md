# OHOS (HarmonyOS) Bun 适配修改清单

> 基准版本: ohos-aarch64 @ 2b3fef82b0 (2026-08-10)
> 用途: merge 上游 oven/main 时，逐项检查上游改动是否触及以下适配点。
> 检查方法: `git diff <upstream>..HEAD -- <file>` 看该文件的上游改动是否与 OHOS 门控逻辑冲突。

---

## 一、OHOS 专属文件（上游完全没有，merge 不会冲突但需保留）

| 路径 | 用途 |
|---|---|
| `scripts/ohos/build-bun-ohos-native.sh` | 原生编译脚本（llvm@21 工具链、V8 stub 注入、relink、签名） |
| `scripts/ohos/build-bun-ohos.sh` | 交叉编译脚本（CI 模式） |
| `scripts/ohos/build.sh` / `run-all-official*.sh` / `patch-node-gyp.sh` / `prepare-cross-libs.sh` / `git-fetch-upstream.sh` | 构建/测试辅助 |
| `src/ohos_sign/` | OHOS ELF 签名工具（binary-sign-tool 替代） |
| `src/runtime/api/bun/ohos_node_userinfo.rs` | node:os userInfo 沙箱 uid 适配 |
| `scripts/build/shims/ohos_compat_shim.c` | LD_PRELOAD 符号拦截（linkat 等） |
| `patches/zstd/ohos-qsort-r.patch` | zstd qsort_r 适配 |
| `.github/workflows/ohos-build*.yml` | OHOS CI |
| `test/js/bun/spawn/spawn-ohos-node-userinfo.test.ts` | 对应测试 |

## 二、构建系统 OHOS 适配（scripts/build/*.ts + webkit.ts）

| 文件 | 适配内容 | merge 检查点 |
|---|---|---|
| `scripts/build/deps/webkit.ts` | **15 处 cfg.ohos**：prebuilt URL、ICU 库名、OHOS_WEBKIT_ROOT、**cmake 配置块**（`CMAKE_SYSTEM_NAME: "Linux"`、CMAKE_FIND_ROOT_PATH/ohosSysroot、ICU_ROOT/ohosIcuDir、`CMAKE_SYSTEM_PROCESSOR: "aarch64"`、静态 JSC 等） | ⚠️ **上游 webkit.ts 无任何 ohos 引用**——上游改 cmake 参数时需检查 OHOS 块是否仍兼容；**WEBKIT_VERSION 升级时需重新构建并验证 OHOS** |
| `scripts/build/flags.ts` | `-fno-pic/-fno-pie/-no-pie` 对 OHOS 跳过（PIE 需要） | 上游改 flags 逻辑时检查 |
| `scripts/build/rust.ts` | OHOS target 的 RUSTUP_HOME/CARGO_HOME 持久化 | 上游改 rust 构建时检查 |
| `scripts/build/workarounds.ts` | "ohos-node-userinfo-preload" 等 | 上游改 preload 机制时检查 |
| `scripts/build.ts` / `bun.ts` / `config.ts` / `source.ts` / `shims.ts` / `tools.ts` / `deps/{cares,zstd}.ts` | OHOS 平台分支（工具链路径、依赖构建） | 上游改构建管线时检查 |
| `rust-toolchain.toml` | nightly-2026-07-20（OHOS Tier3 需 build-std） | ⚠️ 上游 bump 时需确认 OHOS 可用 |
| `.rust-nightly-version` | nightly-2026-07-20 | 同上 |

## 三、spawn 管道机制（T50 内核 bug 适配）——⚠️ 最高风险区

**背景**：OHOS 内核 epoll 对 pipe/socketpair **永不报告 readable**（T50），但 `ioctl(FIONREAD)` 可见字节。所有读取需绕过 poll。

| 文件 | 适配内容 | merge 检查点 |
|---|---|---|
| `src/runtime/cli/multi_run.rs` | ① `ProcessHandle::start`（~237/253）：start 后 `deinit_poll_keep_fd()` 取消 epoll 注册 ② `drain_ohos_pipes`/`drain_one`（577+）：每 tick FIONREAD + raw `libc::read` 循环到 EAGAIN，EOF 靠 read=0 ③ 主循环（1423）：`tick_without_idle` 非阻塞 tick + drain + 2ms sleep ④ `drain_and_close_pipes`（319-355）：OHOS 分支同步 raw drain + force-end | ⚠️ **上游已多次改动此文件**（#37206/#37286）：每次 merge 需确认 OHOS 门控保留且与新逻辑兼容（drain_and_close_pipes 的 OHOS 分支是"同步 drain 后再 force-end"，不能整体跳过也不能只用 BufferedReader::read） |
| `src/io/pipes.rs` | `PollOrFd::deinit_poll_keep_fd()`（pub，仅 OHOS multi_run 用） | 上游改 PollOrFd 时检查该方法保留 |
| `src/event_loop/MiniEventLoop.rs` | `tick_without_idle` 改 `pub`（OHOS multi_run 跨 crate 调用） | ⚠️ 上游是 `pub(crate)`——上游改回 pub(crate) 会破坏 OHOS 编译 |
| `src/runtime/cli/filter_run.rs` | ① `--workspaces/--filter` 的 pipe_setup（SOCKET|NONBLOCKING flags）② `drain_and_close_pipes` OHOS 跳过 `BufferedReader::read`（保留 deinit） | 上游 #37286 加了 drain_and_close_pipes——OHOS 需跳过 read 避免与 drain 竞争 |
| `src/runtime/api/bun/spawn/stdio.rs` | `can_use_memfd`/`use_memfd` OHOS 返回 false（memfd 写入对 fstat 不可见 + 子进程崩溃） | ⚠️ 上游若改 memfd 逻辑，OHOS 必须保持禁用 |
| `src/sys/lib.rs` `can_use_memfd` | OHOS 全局禁用 memfd（`excluded even though memfd_create works`） | 同上，sys 层统一门控 |
| `src/spawn_sys/spawn_process.rs` | ① memfd fast-path 三处 `not(target_env="ohos")`（CStr import、'stdio label、use_memfd 块）→ OHOS 回退 socketpair ② **shebang 手动解析**（1004-1090）：OHOS 上 exec 脚本时手动读 shebang 构造 argv（内核 shebang 处理差异） | ⚠️ 上游改 spawn 时检查 memfd 门控 + shebang shim |
| `src/install/PackageManager/PackageManagerLifecycle.rs` | lifecycle PATH 注入：前置 bun_dir + node_dir（`~/.harmonybrew/bin`）+ `NODE=bun`（411-445） | ⚠️ 上游改 PATH 注入时，OHOS 前置必须保留（测试 PATH="" 场景依赖） |
| `src/io/PipeWriter.rs` | F_SETPIPE_SZ 管道缓冲扩到 1MB（244） | 上游改 PipeWriter 时检查 |

## 四、syscall 层适配（src/sys/lib.rs + linux_syscall.rs）

| 位置 | 适配内容 | merge 检查点 |
|---|---|---|
| `fstat`（2117-2125） | **OHOS seccomp 对 pipe fd 的 fstat 返回 EACCES** → 返回 zeroed stat（否则 spawn 子进程初始化崩溃） | ⚠️ 上游改 fstat 时，OHOS EACCES→zeroed 分支必须保留 |
| `statx`（2183+） | OHOS 归入 musl/raw-syscall 分支（libc 无 statx wrapper） | 上游改 statx 时检查 cfg 分组 |
| `statx_fallback`（2369） | OHOS 的 EBADF 也触发 fallback（socket fd 上 statx 返回 EBADF） | 同上 |
| `getcwd`（2684） | OHOS hmdfs 缓存已删 cwd → stat(".") 探测 ENOENT | 上游改 getcwd 时检查 |
| `link`（2709 附近） | OHOS 裸 linkat syscall EACCES → 走 libc `linkat` 符号（shim 拦截） | ⚠️ 上游改 link 时，OHOS 必须走 linkat |
| `lchmod`（2955 附近） | **OHOS 无 fchmodat2（syscall 452 被 seccomp SIGSYS）** → 回退普通 chmod（bin 链接执行位依赖） | ⚠️ 上游改 lchmod 时，OHOS 回退必须保留（node-gyp 测试依赖） |
| `src/sys/linux_syscall.rs` | OHOS syscall 包装差异（fstat/statx 等） | 上游改时检查 |
| `src/bun_core/env.rs` | `IS_MUSL = cfg!(musl \|\| ohos)` | 上游改 env 检测时检查 |

## 五、CLI / 运行时代码适配

| 文件 | 适配内容 | merge 检查点 |
|---|---|---|
| `src/runtime/cli/run_command.rs` | ① 目录遍历 EACCES/EPERM 时 fallback HOME package.json（630-720）② **`bun node <file>`**：`IS_NODE_ARG` 检测 + exec_as_if_node 移除 "node" 占位 + 重解析 node flags（3077+） | ⚠️ 上游改 run_command 时，IS_NODE_ARG 逻辑和 OHOS 目录 fallback 必须保留（as-node 测试 11 个依赖） |
| `src/runtime/cli/mod.rs` | `IS_NODE_ARG` 静态标志 + which() 的 `first_arg_name == "node"` 分支 | 同上 |
| `src/runtime/ffi/ffi_body.rs` | aarch64 系统头/库路径：OHOS_SYSROOT → /system/include → /usr/include/aarch64-linux-gnu | 上游改 FFI 默认路径时检查 |
| `src/runtime/napi/napi_body.rs` | OHOS 的 V8 符号引用（Array::New/CpuProfiler::CollectSample）——构建期 stub 依赖 | ⚠️ 上游改 napi 引用 V8 符号时，需同步更新 `build-bun-ohos-native.sh` 的 v8_stub.cpp（`__1` namespace） |
| `src/runtime/node/node_fs.rs` | `link` OHOS 走 linkat（5563） | 上游改 node:fs link 时检查 |
| `src/jsc/bindings/v8/V8Array.cpp` | `__MUSL__` 条件（V8 符号 stub 相关） | 上游改 V8Array 时检查 |
| `src/jsc/bindings/highway_json.cpp` / `src/jsc/bindings/highway_sourcemap.cpp` / `src/jsc/bindings/highway_xml.cpp` | aarch64 SVE 禁用（`HWY_DISABLED_TARGETS`）——scalable SVE 缺符号 | 上游改 highway 时检查 |
| `src/jsc/bindings/webcore/MessagePort.h` / `src/jsc/bindings/webcore/MessagePort.cpp` | `m_closeEventPending` leak fix（Worker 关闭 port 后 contextDestroyed 清理） | 上游改 MessagePort 生命周期时检查（曾有冲突 5e7b6e14ac） |
| `src/jsc/bindings/bun-spawn.cpp` | OHOS spawn 平台分支 | 上游改时检查 |
| `src/jsc/bindings/c-bindings.cpp` | close_range 的 `#if OS(LINUX)||OS(FREEBSD)` 块闭合 | 上游改 close_range 时检查 |
| `src/jsc/bindings/BunProcess.cpp` / `bun-spawn.cpp` | OHOS 平台分支 | 上游改时检查 |
| `src/install/PackageManager.rs` | node-gyp 的 CC/CXX/LDFLAGS 默认值（cc/c++ + `-Wl,--code-sign`）（1184） | ⚠️ 上游改 node-gyp 环境时，OHOS 默认编译器必须保留 |
| `src/install/PackageInstaller.rs` / `src/install/isolated_install.rs` / `src/install/isolated_install/Hardlinker.rs` | OHOS 文件系统/硬链接差异 | 上游改 install 时检查 |
| `src/resolver/lib.rs` / `src/resolver/resolver.rs` | OHOS 目录权限 fallback | 上游改 resolver 时检查 |
| `src/runtime/api/bun/js_bun_spawn_bindings.rs` | OHOS node userInfo env 注入（ohos_node_userinfo，1015） | 上游改 spawn env 时检查 |
| `src/runtime/shell/subproc.rs` | OHOS spawn 差异 | 上游改 shell 时检查 |
| `src/runtime/webcore/blob/read_file.rs` | OHOS 读文件差异 | 上游改 blob 时检查 |
| `src/spawn/process.rs` | OHOS watcher/pidfd 差异 | 上游改 spawn 时检查 |
| `src/crash_handler/lib.rs` | OHOS crash 处理 | 上游改时检查 |
| `src/dns/lib.rs` / `src/runtime/dns_jsc/dns.rs` | OHOS DNS | 上游改时检查 |
| `src/standalone_graph/StandaloneModuleGraph.rs` | OHOS 差异 | 上游改时检查 |
| `src/options_types/context.rs` | OHOS 差异 | 上游改时检查 |
| `src/bun_bin/lib.rs` | OHOS 入口差异 | 上游改时检查 |
| `src/runtime/api.rs` | OHOS API 注册 | 上游改时检查 |

## 六、测试文件 OHOS 特判

| 文件 | 内容 | merge 检查点 |
|---|---|---|
| `test/cli/run/garbage-env.test.ts` | openharmony 平台下 binary-sign-tool 签名 | 上游改该测试时检查 |
| `test/js/bun/spawn/spawn-ohos-node-userinfo.test.ts` | OHOS 专属测试 | 保留 |

### 六-1、全量测试收集逻辑差异（OHOS 脚本 vs 上游 CI）——2026-08-12 记录

**结论：全量脚本 `run-all-official-progress-optimized.sh` 只跑 ~2025 个文件，而上游 CI 跑 5848 个，二者定义不同，非 bug。差异几乎全部来自 Node 官方测试目录。**

| 维度 | 全量脚本（OHOS） | 上游 CI（`scripts/runner.node.mjs`） |
|---|---|---|
| 收集方式 | `find` 扩展名白名单 | 递归扫描 + 目录特判 |
| 匹配规则 | 仅 `*.test.ts/js/tsx/jsx/mjs/cjs/mts/cts` + `*.spec.ts/tsx/js/cjs/mjs/cts` | `isJavaScript`（`.js/.ts/.jsx/.tsx/.mjs/.cjs/.mts/.cts`）+ 文件名含 `.test` 或 `spec.`，**或** `isNodeTest`，**或** `isClusterTest` |
| node 官方测试目录 | ❌ **不收** | ✅ **整个目录都收**：`js/node/test/parallel/`（3658 个）、`js/node/test/sequential/`（85 个）、`js/bun/test/parallel/`（83 个） |
| 默认排除 | 无 | `integration/bun-types`（22 个）+ `internal/source-lints` |
| 文件数 | **2025** | **5848**（CI 实际运行 5826） |

**原因**：Node 官方测试用 `test-*.js` 命名（无 `.test` 后缀），find 白名单永远匹配不到。OHOS 上测试比 Linux 慢 5-10x（7/21 全量：1868 files / 01:31:24 / 92 timeouts），加入 3658 个 node parallel 测试将使时长增至 5-6 小时且大量已知失败，故**有意排除**。

**若需完全对齐 CI**：把 3 个 node 目录加入 find（`-path "test/js/node/test/parallel/*"` 等），但 OHOS 上显著变慢。

---

## 七、merge 上游时的检查清单（按优先级）

### 🔴 必须人工验证（历史冲突/高风险）
1. **multi_run.rs** —— 上游每改一次都需重测 `multi-run.test.ts`（120+ 用例）+ 手动 parallel/sequential
2. **spawn_process.rs memfd 门控** —— 上游若改 memfd 逻辑，OHOS 必须禁用（uses-what-bin-slow SIGABRT 回归）
3. **sys/lib.rs lchmod** —— 上游若改 lchmod，OHOS 回退 chmod 必须保留（node-gyp 测试）
4. **PackageManagerLifecycle.rs PATH 注入** —— OHOS 前置 bun_dir/node_dir 必须保留（lifecycle 测试 PATH="" 场景）
5. **run_command.rs IS_NODE_ARG** —— `bun node` 支持（as-node 测试 11 个）
6. **webkit.ts** —— 上游版本号升级需重新构建验证；上游 cmake 改动需检查 OHOS 块

### 🟡 需检查（OHOS 门控存在但上游少动）
7. MiniEventLoop.rs `tick_without_idle` pub 可见性
8. filter_run.rs drain 门控
9. MessagePort leak fix、highway SVE、V8Array、c-bindings
10. sys/lib.rs fstat/statx/getcwd/link
11. napi_body V8 符号 → v8_stub.cpp 同步

### 🟢 冲突概率低（上游不常动）
12. ffi_body 系统路径、node_fs link、PackageManager CC/CXX、其余

## 八、验证命令（merge 后必跑）

```bash
# 构建（脚本含 configure + relink + 签名）
./scripts/ohos/build-bun-ohos-native.sh

# 核心回归（部署到 all-tests 后）
bun test test/cli/run/multi-run.test.ts            # 120+ 用例
bun test test/cli/run/as-node.test.ts              # 11 用例
bun test test/cli/install/bun-install-lifecycle-scripts.test.ts -t "node-gyp"  # 17 用例
# uwbs repro（memfd）
PATH="" bun install --no-save  # uses-what-bin-slow 场景
```

---

## 九、历史冲突记录（merge 教训）

| 上游 commit | 冲突 | 解决 |
|---|---|---|
| #37286 multi-run EOF fix | multi_run/filter_run drain_and_close_pipes | OHOS 分支同步 drain + force-end（不能整体跳过——detached 卡死；不能只 deinit——输出丢失） |
| #37228 WebKit bump | webkit.ts 无 OHOS 支持 | 保留 OHOS cmake 块 + 更新版本号；WebKit 源码用上游干净版 |
| 5e7b6e14ac MessagePort | contextDestroyed 冲突 | 保留 OHOS leak fix（m_closeEventPending） |
| 0a526e139e m_closeEventPending 声明 | 声明冲突 | 保留 OHOS 版本 |
| c26e9d0aea c-bindings close_range | `#if` 块闭合 | 保留本地补丁 |
