# Support Linux ARM64 64KB page builds with latest WebKit

## 背景

本次改动的目标是让 Bun 在最新本地 WebKit 依赖下，完成 Linux ARM64 64KB page 环境的构建与基础运行验证。

对应分支：`fix-latest-webkit-64kb-linux-arm64`

关键提交：

- `63a02de4f5` `Support local 64KB Linux Bun builds`
- `bc693e6c8a` `Adapt Bun for latest WebKit 64KB Linux builds`

## Summary

- 补齐 Bun 本地构建链路对 Linux ARM64 64KB page 的支持
- 适配最新 WebKit/JSC API 变化，修复 bindings、生成代码和无 JIT 场景的兼容问题
- 与配套 WebKit 分支联动后，在 `llm-12` 的 64KB page 环境完成 smoke test

## Changes

### 构建链路

- 在 Linux ARM64 本地 WebKit 构建路径中启用 `USE_64KB_PAGE_BLOCK=ON`
- 调整 Bun 构建脚本，减少本地 64KB 构建过程中的不稳定因素
- 简化 Zig 构建调用路径，避免本地 `--console` / 进度通道带来的异常
- 为当前工具链补充 `-Wno-undefined-var-template`

### Bun 与最新 WebKit API 适配

- 更新 `ZigGlobalObject`、`NodeVM`、`bindings` 等 JSC 接口适配逻辑
- 兼容 `JSPromise::resolve(...)`、wasm streaming、static globals、GC visitor/output constraints 的最新签名变化
- 修复多处 WebCore custom bindings 与当前 WebKit 生成代码风格的兼容问题
- 更新代码生成逻辑，使生成产物与最新 WebKit 的 GC 集成方式一致

### 运行时结果

- 结合配套 WebKit 修复后，Bun 可在 Linux ARM64 64KB page 环境执行最小 JS 和基础文件 IO

## Validation

验证环境：`llm-12`

```bash
uname -m
getconf PAGE_SIZE
```

结果：

- `uname -m` 输出 `aarch64`
- `getconf PAGE_SIZE` 输出 `65536`

使用本分支与配套 WebKit 分支构建本地产物后，在 `ubuntu:24.04` arm64 容器内验证：

```bash
./bun --revision
./bun --version
./bun -e "console.log(process.arch, process.platform, Bun.version)"
./bun -e 'await Bun.write("/tmp/a.txt", "ok"); console.log(await Bun.file("/tmp/a.txt").text())'
```

结果：

- `./bun --revision` -> `1.3.11-canary.1+bc693e6c8`
- `./bun --version` -> `1.3.11`
- `./bun -e "console.log(process.arch, process.platform, Bun.version)"` -> `arm64 linux 1.3.11`
- `./bun -e 'await Bun.write("/tmp/a.txt", "ok"); console.log(await Bun.file("/tmp/a.txt").text())'` -> `ok`

## Risk/Notes

- 本 PR 主要覆盖 Linux ARM64 64KB page 场景
- Bun 侧改动多数是为了跟进最新 WebKit API 漂移，风险集中在 JSC bindings、WebCore custom bindings 和生成代码
- 本 PR 依赖配套 WebKit 分支 `fix/structure-heap-64kb-linux-arm64`
