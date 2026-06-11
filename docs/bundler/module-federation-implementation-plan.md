# Bun 支持 Module Federation 的实现方案

这份文档用于后续多个对话或多个 agent 接力实现 Bun bundler 的 Module Federation 支持。分析依据：

- Bun 源码：`/Users/bytedance/outter/bun`
- Rspack 新版 MF 入口：`/Users/bytedance/outter/rspack/packages/rspack/src/container/ModuleFederationPlugin.ts`
- Rspack MF runtime 与 manifest 插件：`/Users/bytedance/outter/rspack/crates/rspack_plugin_mf`

目标不是照搬 Rspack V1。Rspack 新版插件内部仍会复用 V1 的容器构造能力，但对 Bun 最有价值的是它的职责拆分：配置归一化、运行时代码注入、manifest 输出、remotes 解析，以及可选的 shared tree-shaking 处理。

## 当前判断

Bun 要做完整 Module Federation，最终需要进入 bundler 层。

普通 Bun 插件可以做原型：通过 `onResolve`、`onLoad`、虚拟模块和 `onEnd` 模拟远程模块加载。但完整 MF 需要这些能力：

- 生成额外的合成入口，例如 `remoteEntry`
- 改写远程模块和 shared 包的导入关系
- 给相关入口和 chunk 注入运行时代码
- 输出 `mf-manifest.json` 这类额外产物
- 控制 remote entry 和远程 chunk 的命名
- 在暴露模块运行前完成 share scope 注册和版本选择

所以建议是：普通插件只用于验证想法；正式能力新增 `Bun.build({ moduleFederation: ... })`，并把配置一路传到 Rust bundler。

## 源码结论

### Bun 侧

- `Bun.build()` 的 JS 配置解析在 `/Users/bytedance/outter/bun/src/runtime/api/JSBundler.rs`。
  - `Config` 已经包含 `entry_points`、`code_splitting`、`external`、`public_path`、`format`、`files`、`metafile`，但还没有 MF 字段：121-171 行。
  - `splitting`、`entrypoints`、`external`、`allowUnresolved` 的解析在 741-925 行。
  - `Bun.build()` 解析完配置后会创建并调度 bundler completion task：1305-1350 行。
- 配置会在 `/Users/bytedance/outter/bun/src/runtime/api/js_bundle_completion_task.rs` 里继续下传。
  - `allow_unresolved`、`code_splitting`、CSS chunking 和 metafile 相关字段在 920-967 行被复制到 `Transpiler` options。
  - 构建产物和 lazy metafile 在 694-724 行返回给 JS。
- Bun 普通插件逻辑在 `/Users/bytedance/outter/bun/src/js/builtins/BundlerPlugin.ts`。
  - 当前插件状态支持 `onLoad`、`onResolve` 和 `onEndCallbacks`：7-10 行。
  - `runOnEndCallbacks` 可以拿到最终构建结果：109-147 行。
- Rust bundler 的图、插件回调和打包流程主要在 `/Users/bytedance/outter/bun/src/bundler/bundle_v2.rs`。
  - `BundleV2` 持有 graph、linker、plugin handle、动态 import 入口和输出状态：80-145 行。
  - `onLoad` 和 `onResolve` 会切回 bundler 自己的 loop 执行：4263-4314 行。
  - `on_resolve` 可以走普通文件解析，也可以把插件解析出来的模块写进 graph：4535-4824 行。
- linking、tree-shaking、code splitting 和 chunk 生成在 `/Users/bytedance/outter/bun/src/bundler/LinkerContext.rs`。
  - link 流程会依次执行 tree-shaking、`compute_chunks`、cross-chunk 依赖计算：872-897 行。
  - tree-shaking 和 code splitting 会标记 live files 与 entry 可达关系：900-1022 行。
- 输出产物结构在 `/Users/bytedance/outter/bun/src/bundler/OutputFile.rs`。
  - `OutputFile` 带有 `output_kind`、`dest_path`、CSS chunk 引用、source index 和字节内容：21-44 行。
  - `Value::Buffer` 可以承载生成出来的额外资产：191-203 行。
- 用户侧类型在 `/Users/bytedance/outter/bun/packages/bun-types/bun.d.ts`。
  - `BuildConfig` 当前有 `splitting`、`entrypoints`、`format`、`naming`、`plugins`、`external`、`allowUnresolved`、`packages`、`publicPath` 等字段：2628-2695 行。

### Rspack 新版 MF 侧

- `/Users/bytedance/outter/rspack/packages/rspack/src/container/ModuleFederationPlugin.ts` 是新版 MF 的总入口。
  - 新选项包括 `runtimePlugins`、`implementation`、`shareStrategy`、`manifest`、tree-shaking shared 相关配置和 `experiments`：25-38 行。
  - 它会把 MF runtime 包挂到 resolve alias 上：46-53 行。
  - 当 shared 开启 tree-shaking 时，会创建虚拟 runtime 模块并在后续补充 fallback 数据：55-93 行。
  - runtime plugin 会在 `beforeRun` 和 `watchRun` 阶段应用：96-135 行。
  - manifest 只在显式开启时应用：152-154 行。
  - remotes 会被归一化为 `alias`、`name`、`entry`、`externalType`、`shareScope`：174-253 行。
  - 默认 runtime source 会注入 runtime plugins、remote infos、container name、share strategy、shared fallbacks 和 library type：337-395 行。
- `/Users/bytedance/outter/rspack/crates/rspack_plugin_mf/src/container/module_federation_runtime_plugin.rs` 展示了 runtime 插件职责。
  - 给相关 runtime tree 增加基础 Federation runtime module：65-79 行。
  - 在 `finish_make` 阶段加入 entry runtime dependency：81-100 行。
  - 开启 async startup 时，把 container entry module 标为 async：105-133 行。
  - 同时应用嵌入 runtime 和引用提升相关插件：156-158 行。
- `/Users/bytedance/outter/rspack/packages/rspack/src/container/ModuleFederationManifestPlugin.ts` 负责归一化 manifest 选项和 build info。
  - build metadata 会读取 package name/version 和 tree-shaking 插件信息：71-99 行。
  - manifest 选项包含 file path/name、remote alias map、exposes 和 shared：110-140 行。
- `/Users/bytedance/outter/rspack/crates/rspack_plugin_mf/src/manifest/mod.rs` 负责真正输出 manifest asset。
  - 它会从 chunk group 里找真实 remote entry 文件：50-98 行。
  - 它会在 process assets 阶段 emit `mf-manifest.json`：99-150 行、676-683 行。
- `/Users/bytedance/outter/rspack/packages/rspack/src/runtime/moduleFederationDefaultRuntime.js` 展示了 runtime 需要消费的数据。
  - 运行时需要 remote info、container name、share strategy、share fallback、library type、shared 定义和 remote chunk map：1-240 行。

## 建议 API

第一步只加 `Bun.build()` API。CLI 后置。

```ts
await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  target: "browser",
  splitting: true,
  moduleFederation: {
    name: "host",
    remotes: {
      remote: "remote@http://localhost:3001/remoteEntry.js",
    },
    exposes: {
      "./Button": "./src/Button.tsx",
    },
    shared: {
      react: { singleton: true, requiredVersion: "^19.0.0" },
      "react-dom": { singleton: true, requiredVersion: "^19.0.0" },
    },
    manifest: true,
    shareStrategy: "version-first",
  },
});
```

初始类型尽量贴近 Rspack 新版 MF：

```ts
interface ModuleFederationOptions {
  name?: string;
  filename?: string;
  exposes?: Record<string, string | string[] | { import: string | string[]; name?: string }>;
  remotes?: Record<string, string | string[] | { external: string | string[]; shareScope?: string }>;
  shared?: Record<
    string,
    string | false | {
      import?: string | false;
      shareKey?: string;
      shareScope?: string;
      version?: string;
      requiredVersion?: string;
      singleton?: boolean;
      strictVersion?: boolean;
      eager?: boolean;
    }
  >;
  manifest?: boolean | { filePath?: string; fileName?: string; disableAssetsAnalyze?: boolean };
  runtimePlugins?: (string | [string, Record<string, unknown>])[];
  shareStrategy?: "version-first" | "loaded-first";
  experiments?: { asyncStartup?: boolean };
}
```

## 兼容目标

按这个顺序实现：

1. Bun remote 被 Bun host 消费，优先 ESM remote。
2. Bun host 消费 Webpack/Rspack 的 script remote。
3. Webpack/Rspack host 消费 Bun 产出的 remote。
4. shared 依赖版本选择和 tree-shaking shared。

先做 ESM remote，因为 Bun bundler 默认就是 ESM，而且 `BuildConfig` 类型里已经有 `format: "esm"`、`format: "cjs"`、实验性的 `format: "iife"`。script/global 兼容可以等 ESM 链路跑通后再加。

## Roadmap

这个 roadmap 按 agent 可接力的方式拆分。除非明确说明可以并行，否则后一个 agent 默认依赖前一个 agent 的产物。

### Agent 1：配置入口

目标：只让 Bun 能识别、校验、保存 `moduleFederation` 配置，不做远程加载。

范围：

- 改 `packages/bun-types/bun.d.ts`
- 改 `src/runtime/api/JSBundler.rs`
- 改 `src/runtime/api/js_bundle_completion_task.rs`
- 改 `src/bundler/options.rs` 或新增 `src/bundler/module_federation/options.rs`

交付：

- `Bun.build({ moduleFederation: ... })` 能接受合法配置
- 非法配置有清晰错误
- 不传 `moduleFederation` 时旧行为不变

验证：

- 配置解析测试
- 旧 bundler 测试不回退

不要做：

- 不做 runtime
- 不做 remote import 改写
- 不做 manifest

### Agent 2：最小运行时和远程 import

目标：让 Bun host 可以通过动态 import 加载一个 Bun remote 的 expose。

依赖：Agent 1。

范围：

- 新增最小 MF runtime
- 实现 remote alias 识别
- 改写 `import("remote/Button")`
- 只支持 ESM remote
- 先不支持 shared

交付：

- host 里 `await import("remote/Button")` 可用
- remote 不会被当成本地 npm 包解析
- 同一个 remote 重复加载只初始化一次

验证：

- host + remote 构建测试
- 浏览器冒烟测试

不要做：

- 不做静态 named export 完整支持
- 不做 Webpack/Rspack remote
- 不做 shared

### Agent 3：remote entry 生成

目标：让 Bun remote 能在同一次 build 里输出 `remoteEntry.js`。

依赖：Agent 1，最好等 Agent 2 的 runtime 形态稳定。

范围：

- 处理 `exposes`
- 生成合成 remote entry
- expose key 映射到真实模块
- remote entry 暴露 `get` 和 `init`
- expose factory 懒加载对应 chunk

交付：

- remote build 输出 `remoteEntry.js`
- host 能加载 remote entry 并取到 expose
- remote expose chunk 不被提前打进 host

验证：

- remote-only 构建测试
- host + remote 端到端测试

不要做：

- 不做 script/global 输出
- 不做 shared 版本选择

### Agent 4：manifest 输出

目标：补齐 `mf-manifest.json`，让后续 agent 和其他工具能读 Bun remote 信息。

依赖：Agent 3。

范围：

- 处理 `manifest: true`
- 输出 `mf-manifest.json`
- 支持自定义 fileName/filePath
- 把 manifest 加入 `BuildOutput.outputs`

交付：

- manifest 指向真实 remote entry
- manifest 包含 exposes、remotes、shared 的基础结构
- manifest 在写盘和 JS 返回值里都能看到

验证：

- manifest 文件存在
- manifest 内容与实际产物匹配

不要做：

- 不做完整 stats 分析
- 不做 tree-shaking shared

### Agent 5：shared singleton MVP

目标：支持最常见的 shared 场景，例如 React 单例。

依赖：Agent 2 和 Agent 3。

范围：

- 解析 shared provider/consumer
- 支持 `singleton`
- 支持 `requiredVersion`
- 支持 fallback import
- 使用 Bun 现有 semver 能力

交付：

- host 和 remote 使用同一个 shared 包时只拿到一个实例
- 版本不兼容时能按配置 fallback 或报错

验证：

- shared singleton 测试
- 版本兼容/不兼容测试

不要做：

- 不做 tree-shaking shared
- 不做复杂 shareStrategy 优化

### Agent 6：Webpack/Rspack 互通

目标：让 Bun 进入现有 MF 生态，而不是只能 Bun-to-Bun。

依赖：Agent 2、Agent 3、Agent 5。

范围：

- Bun host 消费 Webpack/Rspack script remote
- Bun remote 输出 script/global container
- 支持 `remote@url` 这类常见写法
- 支持 remote script 只加载一次

交付：

- Bun host 可以加载 Rspack remote
- Rspack host 可以加载 Bun remote

验证：

- Rspack remote + Bun host 集成测试
- Bun remote + Rspack host 集成测试

不要做：

- 不做所有历史 Webpack remoteType
- 不做旧版特殊边界兼容，除非有明确用例

### Agent 7：高级能力和收尾

目标：补齐生产可用体验。

依赖：前面阶段基本完成。

范围：

- manifest-based remote loading（已完成）
- runtimePlugins（已完成 MVP）
- asyncStartup（已完成 Bun target 和浏览器 target 覆盖）
- tree-shaking shared（暂缓，先不实现）
- 文档和示例
- 性能回归检查

Agent 7 已分批完成 manifest-based remote loading、runtimePlugins MVP 和
asyncStartup 的 Bun target 与浏览器 target 覆盖。浏览器产物里的静态 remote
import 会在入口用户代码执行前完成 remote 加载、container 初始化和 expose
factory 执行；remote 加载失败会继续抛出可观测错误，不会静默进入入口代码。

Agent 7 收尾把 host runtime 基座切到官方 `@module-federation/runtime`。
Bun bundler 的职责是生成 remoteEntry、manifest、remote/shared 代理模块，以及
把 remotes、shared、runtimePlugins、shareStrategy 等配置注册给官方 runtime；
Bun 不再继续扩展 browser 内联 runtime 或 `bun:module-federation-runtime` 作为
host 默认路径。`bun:module-federation-runtime` 只作为过渡兼容模块保留，避免
立刻破坏已有直接 import 的实验代码。

manifest-based remote loading 支持 host remote 配置写
`{ manifest: "https://remote.example/mf-manifest.json" }`。生成的 proxy 会先读取
manifest，解析 remoteEntry，再通过 `@module-federation/runtime` 的
`registerRemotes()` / `loadRemote()` 进入官方加载流程。Bun 生成的
`mf-manifest.json` 也改为包含官方 runtime/sdk 可消费的 `metaData`、
`exposes`、`remotes`、`shared` 形状，同时保留少量历史字段用于过渡。

当前不实现 Bun/Node CLI 场景下的 HTTP ESM remoteEntry 加载。Vite 官方
Module Federation 插件产出的 remoteEntry 属于 ESM remote，浏览器 host 可以通过
原生 ESM 加载；Bun CLI/Node 风格执行暂不支持直接消费这类远程入口。后续如果有
明确社区需求，再单独设计远程 ESM 加载方案，不把该能力混入当前收尾任务。

tree-shaking shared 先暂缓，不作为当前 Agent 7 必须交付项。文档示例和
性能回归检查仍留给后续小步实现。

Agent 8.1 做真实跨工具互通收尾，不改官方 runtime 语义，也不做
tree-shaking shared。新增的互通验收使用 Webpack 5.88.0
`ModuleFederationPlugin` 实际生成的 remote fixture，而不是手写 remoteEntry
字符串。当前已验证方向是 Bun host 通过官方
`@module-federation/runtime` 消费真实 Webpack 风格 remoteEntry，并能加载
remote default expose；同一 remote 重复 import 时 remoteEntry 只加载一次；请求
不存在的 expose 时会把 Webpack container 的错误暴露给用户。named export
interop 未在本小步覆盖。

Webpack fixture 选择 `target: "node"`、名为 `webpackRealRemote` 的 `var`
library、`publicPath: ""` 和 `LimitChunkCountPlugin({ maxChunks: 1 })`。原因是
Bun target host 目前通过官方 runtime 加 Bun
eval/global 兼容路径加载 script/global remote；Webpack 浏览器向
`publicPath: "auto"` 产物依赖 `document.currentScript` 推导 publicPath 和
JSONP chunk loader，这个边界未在本小步验证，留作后续独立互通任务。

Agent 9 已完成真实反向互通验证：Webpack 和 Rspack script/global host 都能消费
Bun 输出的 script/global remote。对应验收测试在
`test/bundler/bun-build-api.test.ts`：

- `moduleFederation Webpack script host imports a real Bun remote`
- `moduleFederation Rspack script host imports a real Bun remote`

这一步复用了 Bun 已能输出的 script/global container，并让 Webpack/Rspack host
通过真实构建产物加载 Bun remote expose。至此，里程碑 D 的主链路不再停留在
“待验证”。

Agent 10 是收尾文档和验收整理，不做新能力，不继续扩展 runtime、bundler
graph 或互通矩阵，也不实现 tree-shaking shared。

交付：

- 高级选项可用
- 文档说明清楚
- 示例覆盖 host、remote、shared、manifest、interop

验证：

- 单测
- 端到端测试
- 构建性能对比
- 跨平台检查

Agent 10 当前复现命令：

```sh
bun bd test test/bundler/bun-build-api.test.ts -t moduleFederation
```

本命令覆盖当前 Module Federation 相关 bundler API 验收，包括 Bun-to-Bun
remote、script/global remote、真实 Webpack remote、Webpack/Rspack host 消费
Bun remote、runtimePlugins、asyncStartup、manifest remote loading、shared
singleton 和 manifest 输出。若本地缺少 `build/debug/bun-debug` 或编译 toolchain，
`bun bd` 会先尝试构建；不能完成构建时，应在交付说明中记录真实失败原因，不要
伪造测试通过。

当前能力边界：

- 已支持 `Bun.build({ moduleFederation })` 配置解析、校验和类型入口。
- 已支持 Bun host 消费 Bun ESM remote，以及通过官方
  `@module-federation/runtime` 消费 script/global remote。
- 已支持 Bun remote 输出 ESM wrapper、script/global container 和
  `mf-manifest.json`。
- 已支持 Bun host 消费真实 Webpack 5 script/global remote。
- 已支持 Webpack/Rspack script/global host 消费 Bun 输出的 script/global remote。
- 已支持 shared singleton 的基础 host/remote share scope、版本 fallback/strict
  行为、runtimePlugins MVP、asyncStartup 和 manifest-based remote loading。
- 暂不支持 Bun/Node CLI 消费 HTTP ESM remoteEntry；Vite 插件产出的 ESM remote
  当前只按浏览器 host 场景说明和验证。
- 仍不保证所有历史 Webpack `remoteType`、浏览器 JSONP/publicPath 自动推导边界、
  named export interop 的完整矩阵、所有 Rspack/Webpack 版本组合和生产级性能基准。
- `tree-shaking shared` 继续暂缓，当前 Agent 10 不实现。

## Agent 接力规则

每个 agent 完成后都要在 PR 或交付说明里写清楚：

- 做到了哪个 roadmap 阶段
- 改了哪些能力
- 哪些测试跑过
- 哪些能力明确没做
- 下一个 agent 应该从哪里继续

不要把多个阶段混在一个大改里。尤其不要在配置入口还没稳定时同时做 runtime、shared 和 interop。

## 实现阶段

### 阶段 0：用户态原型

目的：先验证运行时语义，不立刻改 native graph。

做一个本地包或测试 helper：

- 在 JS 里解析 `moduleFederation` 配置
- 用 Bun plugin 改写 `remote/Button` 这类远程 import
- 返回虚拟模块，内部调用 `loadRemote("remote/Button")`
- remote 侧用单独一次 `Bun.build()` 生成简易 remote entry
- 在 `onEnd` 里写一个简单 manifest

预期限制：

- 无法完整控制 output chunk graph
- 无法在同一次 build 里可靠加入合成入口
- 无法正确处理所有 shared import site
- 无法保证和现有 MF host 完整互通

退出标准：

- 一个 host app 能加载一个 remote app 的一个 expose
- 浏览器里的动态 import 链路可用
- host 重复加载同一个 remote 时不会重复初始化 runtime

### 阶段 1：原生配置入口

涉及文件：

- `/Users/bytedance/outter/bun/packages/bun-types/bun.d.ts`
- `/Users/bytedance/outter/bun/src/runtime/api/JSBundler.rs`
- `/Users/bytedance/outter/bun/src/runtime/api/js_bundle_completion_task.rs`
- `/Users/bytedance/outter/bun/src/bundler/options.rs`

任务：

- 在 Bun 类型里新增 `ModuleFederationOptions`
- 给 `BuildConfig` 增加 `moduleFederation?: ModuleFederationOptions`
- 在 Rust 侧解析 JS 配置
- 把 exposes/remotes/shared 归一化成 owned Rust 结构
- 提前校验不支持的组合
- 把配置下传到 `Transpiler` 或 bundler options

验证：

- `Bun.build({ moduleFederation: 1 as any })` 有清晰错误
- 合法 `moduleFederation` 配置可以通过
- 不传 `moduleFederation` 时现有行为不变

### 阶段 2：Bun MF 运行时核心

涉及文件：

- 新增 runtime 模块，放在 `/Users/bytedance/outter/bun/src/js/builtins/` 或 `/Users/bytedance/outter/bun/src/bundler/` 生成 runtime source
- bundler 侧虚拟模块生成逻辑放在 `/Users/bytedance/outter/bun/src/bundler/bundle_v2.rs` 或新的 MF 模块

runtime MVP（历史阶段）：

- 全局 federation registry
- share scope map
- remote registry
- `initShareScope(scope, shared)`
- `registerRemote(alias, entry, type, shareScope)`
- `loadRemote(specifier)`
- `createContainer({ get, init })`

这一路线已经被 Agent 7 收尾替换：host 默认运行时必须使用官方
`@module-federation/runtime`。Bun 自研 runtime 不再扩展新语义，只作为兼容层
保留。

验证：

- runtime 可以通过 `import(entry)` 加载 ESM remote entry
- `get("./Button")` 能返回 factory
- 重复调用 `init()` 是幂等的

### 阶段 3：远程 import 改写

涉及文件：

- `/Users/bytedance/outter/bun/src/bundler/bundle_v2.rs`
- `/Users/bytedance/outter/bun/src/bundler/Graph.rs`
- `/Users/bytedance/outter/bun/src/bundler/LinkerContext.rs`

任务：

- 识别 import specifier 的第一段是否命中 configured remote alias
- 命中 remote 时不要继续按普通 npm 包解析
- 创建 `bun-mf-remote` 这类 namespace 的合成模块
- 对 static import，生成调用 runtime 的模块 wrapper
- 对 dynamic import，保持异步语义，调用 `loadRemote`
- 记录 remote metadata，给 runtime 注入和 manifest 使用

可能的生成模块：

```js
import { loadRemote } from "@module-federation/runtime";
const mod = await loadRemote("remote/Button");
export default mod.default;
export * from "bun-mf-runtime-generated:remote/Button";
```

这里要小心：如果没有 remote metadata，静态 named export 很难提前知道。建议先支持动态 import 和 default export，再通过 manifest metadata 支持 named export。

验证：

- `await import("remote/Button")` 可用
- 当 remote expose 有 default export 时，静态 default import 可用
- 构建不会尝试去 `node_modules` 解析 `remote`

### 阶段 4：remote entry 生成

涉及文件：

- `/Users/bytedance/outter/bun/src/bundler/bundle_v2.rs`
- `/Users/bytedance/outter/bun/src/bundler/entry_points.rs`
- `/Users/bytedance/outter/bun/src/bundler/LinkerContext.rs`
- `/Users/bytedance/outter/bun/src/bundler/OutputFile.rs`

任务：

- 配置了 `exposes` 时，在同一次 build 里加入合成 remote entry
- 把 expose key 映射到真实源码模块
- 输出 `remoteEntry.js` 或用户配置的文件名
- remote entry 暴露 container：
  - `get(request)`
  - `init(shareScope)`
- exposed module factory 应该懒加载 expose 对应 chunk
- remote entry 要尊重 `publicPath` 和 chunk 命名

先做 ESM remote entry：

```js
import { createContainer } from "./bun-mf-runtime.js";
const container = createContainer({
  "./Button": () => import("./chunks/Button.js"),
});
export const get = container.get;
export const init = container.init;
export default container;
```

再做 script/global remote entry：

```js
globalThis.remote = container;
```

验证：

- remote build 输出 `remoteEntry.js`
- host build 可以 import remote expose
- remote expose chunk 不会被提前打进 host

### 阶段 5：给 host 和 remote 注入 runtime

涉及文件：

- `/Users/bytedance/outter/bun/src/bundler/LinkerContext.rs`
- `/Users/bytedance/outter/bun/src/bundler/Chunk.rs`
- 阶段 2 里的 runtime source 模块

任务：

- 使用 remotes 或 shared 的 entry，在 remote loading 前初始化 MF runtime
- remote entry 在 exposed factory 运行前完成 shared provide 初始化
- 向 runtime bootstrap 注入 remote info、container name、share strategy、library type
- 避免给不相关 chunk 注入 runtime
- 生成的 runtime 代码要稳定，避免影响 hash 不可控变化

Rspack 的参考做法：

- TS 层用归一化后的路径和选项构造 runtime source
- Rust 插件加入 runtime dependency 和 runtime module
- Bun 需要实现同类职责，但不能依赖 Webpack 的 runtime globals

验证：

- 一个 host 加载两个 remote 时都能正常工作
- remote 有一个 expose 时只初始化一次
- 重复 import 不会重复请求同一个 remote

### 阶段 6：shared 依赖

涉及文件：

- `/Users/bytedance/outter/bun/src/bundler/bundle_v2.rs`
- `/Users/bytedance/outter/bun/src/bundler/LinkerContext.rs`
- `/Users/bytedance/outter/bun/src/semver/`

MVP：

- 支持 `singleton`
- 支持 `requiredVersion`
- 支持 `shareScope`
- 支持本地 fallback import
- 支持 `loaded-first` 和 `version-first`

实现思路：

- 配置解析时归一化 shared
- provider build 注册包 factory 和版本
- consumer build 把 shared 包的 import site 改写到虚拟 shared 模块
- 如果没有兼容 provider，且配置允许 fallback，就使用本地打包模块
- 如果 `import: false` 且没有兼容 provider，则报错
- 版本比较使用 Bun 已有 semver 能力，不要手写字符串比较

shared 的 tree-shaking 后置。Rspack 是用第二次独立构建和 runtime fallback update 来处理的，Bun 不应该在 MVP 一开始就做这个。

验证：

- 两个 remote 使用同一个 singleton 包时，最终只有一个实例
- 版本不兼容时按配置 fallback 或报错
- 未开启 shared 时 tree-shaking 行为不变

### 阶段 7：manifest 输出

涉及文件：

- `/Users/bytedance/outter/bun/src/bundler/OutputFile.rs`
- `/Users/bytedance/outter/bun/src/bundler/bundle_v2.rs`
- `/Users/bytedance/outter/bun/src/runtime/api/js_bundle_completion_task.rs`

任务：

- `manifest` 开启时输出 `mf-manifest.json`
- 可选输出 `mf-stats.json`
- manifest 至少包含：
  - container name
  - global name
  - remote entry name
  - public path
  - exposes
  - shared
  - remotes
  - expose/chunk 对应 assets
  - package name/version 这类 build info
- manifest 要作为 `OutputFile` 加入，这样 `BuildOutput.outputs` 也能看到
- 写盘路径走现有 output flow

Rspack 的参考做法：

- Rspack 从 chunk groups 里找真实 remote entry 文件
- Rspack 在 process assets 阶段 emit manifest asset
- Bun 应该在 chunks 完成后，从 `OutputFile` 和 `Chunk` 数据里推导这些信息

验证：

- `manifest: true` 会写出 `mf-manifest.json`
- 自定义 manifest 文件名和路径可用
- manifest 指向真实生成的 remote entry 和 chunks

### 阶段 8：跨工具兼容

按这个顺序做：

1. Bun host 消费 Bun ESM remote。
2. Bun host 消费 Rspack/Webpack script remote。
3. Rspack/Webpack host 消费 Bun script/global remote。
4. 支持基于 manifest 的 remote loading。
5. 支持 runtime plugin hooks。

script remote：

- 解析 `remote@http://localhost:3001/remoteEntry.js`
- script 只加载一次
- 从 `globalThis[remoteName]` 读取 container
- 调用 `container.init(scope)` 和 `container.get(expose)`

ESM remote：

- 浏览器 host 可以消费 ESM remote。
- Bun/Node CLI 暂不支持 HTTP ESM remoteEntry。Vite 官方 Module Federation 插件
  产出的 remoteEntry 属于这个边界，当前先作为浏览器场景支持。
- 后续如果要支持 CLI 里的 HTTP ESM remote，需要单独设计加载策略和测试矩阵。
- 配置形态可以保留对象写法，但不要在当前阶段承诺 HTTP ESM CLI 可运行：

```ts
remotes: {
  remote: {
    // 仅用于 browser host；Bun/Node CLI 暂不支持 HTTP ESM remoteEntry。
    external: "http://localhost:3001/remoteEntry.js",
    type: "module",
  },
}
```

验证：

- Bun host 可以消费 Rspack remote
- Rspack host 可以消费 Bun remote
- 两种情况下 manifest 都准确

## 建议内部模块布局

MF 代码应该集中放置：

```txt
src/bundler/module_federation/
  mod.rs
  options.rs
  normalize.rs
  runtime.rs
  remote_import.rs
  remote_entry.rs
  shared.rs
  manifest.rs
```

不要把 MF 判断散落到 bundler 各处。现有文件只在明确阶段调用这个模块：

- 配置解析
- entrypoint 创建
- import 解析
- link/runtime 注入
- output asset 生成

## 测试计划

遵守 `/Users/bytedance/outter/bun/AGENTS.md` 的规则：

- native 代码改动不要用系统 `bun test` 验证
- 使用 `bun bd test <test-file>`
- 如果合适，先用 `USE_SYSTEM_BUN=1 bun test <test-file>` 证明测试在旧实现下失败，再用 `bun bd test <test-file>` 证明新实现通过

推荐测试：

1. 配置解析
   - 非法 `moduleFederation` 值
   - 合法空配置
   - exposes/remotes/shared 归一化
2. remote imports
   - dynamic remote import
   - remote import 不走 node_modules 解析
3. remote entry
   - remote build 输出 remote entry
   - exposed module factory 加载正确 chunk
4. host + remote 浏览器冒烟测试
   - 构建 host 和 remote
   - 用随机端口 serve 两边
   - 浏览器加载 host 并渲染 remote 组件
5. shared singleton
   - host 和 remote import 同一个 shared 依赖
   - runtime 只解析出一个实例
6. manifest
   - manifest 输出存在
   - manifest 里的 remote entry 指向真实生成文件

可能放置测试的位置：

- `test/bundler/bundler_compile.test.ts`
- `test/bundler/bundler_plugin.test.ts`
- 如果用例变多，新增 `test/bundler/bundler_module_federation.test.ts`

集成类测试必须用 `port: 0`，不要写死端口。

## 里程碑

### 里程碑 A：Bun-to-Bun Remote Loading

- `moduleFederation` 选项存在并能校验
- host 可以配置一个 remote alias
- remote 可以配置一个 expose
- host 可以在浏览器动态 import remote expose
- 暂不要求 shared
- 暂不要求 manifest

### 里程碑 B：Manifest 和稳定输出

- `remoteEntry.js` 文件名可配置
- 能输出 `mf-manifest.json`
- manifest 包含 exposes/remotes/shared 结构
- `BuildOutput.outputs` 包含 manifest

### 里程碑 C：Shared Singleton

- shared 配置能解析
- shared providers 能注册
- shared consumers 能从 share scope 加载
- fallback import 可用
- 版本检查使用现有 semver 能力

### 里程碑 D：Webpack/Rspack 互通

- Bun host 消费 script remote（已完成 Bun 生成 remote 和真实 Webpack 5
  script/global remote fixture 覆盖）
- Bun remote 能输出 script/global container（已完成基础覆盖）
- Webpack/Rspack host 消费 Bun remote（已完成真实 Webpack/Rspack host 验证）
- host 和 remote 的互通测试通过（Bun host -> Webpack remote、Webpack/Rspack host
  -> Bun remote 均已覆盖）

### 里程碑 E：高级运行时能力

- runtime plugins（已完成 MVP）
- async startup（已完成 Bun target 和浏览器 target 覆盖）
- manifest-based remote loading（已完成）
- tree-shaking shared（暂缓，先不实现）

## 风险和决策

- 没有 remote metadata 时，很难静态知道远程模块的 named exports。先做 dynamic import 和 default export，再用 manifest metadata 支持 named export。
- Bun 默认 ESM 输出比 Webpack 风格 script/global container 更容易。先做 ESM remote entry，但 API 要预留 script remote 空间。
- shared package tree-shaking 是高级能力，不要阻塞 MVP。
- host runtime 语义归官方 `@module-federation/runtime` 所有；Bun bundler 只生成
  产物和注册代码。避免继续在 Bun core 中复制官方 runtime 的 hook、share
  scope、manifest 解析语义。
- 只改 JS plugin 行为只能算原型，不算完整支持。

## 第一个 agent 任务

第一个实现 agent 只做阶段 1：

1. 在 `packages/bun-types/bun.d.ts` 增加 `moduleFederation` 类型。
2. 在 `src/bundler/module_federation/options.rs` 或 `src/bundler/options.rs` 增加 Rust option struct。
3. 在 `src/runtime/api/JSBundler.rs` 解析并校验 `moduleFederation`。
4. 在 `src/runtime/api/js_bundle_completion_task.rs` 把配置下传到 bundler options。
5. 增加聚焦的测试，证明配置可以正确接受和拒绝。

在这个阶段本地通过或合并前，不要开始 remote runtime 实现。
