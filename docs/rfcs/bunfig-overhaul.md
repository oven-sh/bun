# Bunfig overhaul

## Booleans

- Only `true` and `"true"` should be considered truthy.
- Default value should always be `false`

## Diff

```diff

  # top-level
  logLevel = "debug"

  # would be nice
+ extends = "base.bunfig.toml"

  # import mapping
+ paths = { "react" = "macro:bun-macro-relay" }


  # list of files to run before running a file
  # for initializing plugins
  # can be extended later with other lifecycle hooks
+ preload = [ "plugins.ts" ]

  # also: deprecate DISABLE_BUN_ANALYTICS
  # or at least rename to BUN_TELEMETRY_DISABLE
+ [telemetry]
+ disable = false

  [debug]
  editor = "code"


  # deprecate old top-level `bun dev` stuff
- framework = "next"
- publicDir = "public"
- external = ["jquery"]
- origin = "http://localhost:3000"
- jsx = "react" # react, solid, react-jsx, react-jsxDEV
- jsxImportSource
- jsxFragment
- jsxFactory

  # redundant with $PORT
  # also it's weird that this corresponds to a Bun.js API instead of a CLI command
- [serve]
- port = 3000


  [dev]
  port = 5000
+ logLevel = "debug" # overrides top-level logLevel
  # new `bun dev` stuff goes under here

  # this should be done with import mapping
  # specifying named import thing is weird
  # especially since this doesn't work:
  # import { graphql, somethingElse } from "react-relay"
- [macros]
- react-relay = { "graphql" = "bun-macro-relay" }

  # deprecate `bun bun` stuff
- [bundle]
- saveTo = "node_modules.bun"
- outDir = "."
- entryPoints = ["./app/index.ts"]
- [bundle.packages]
- "@bigapp/design-system" = true


  [define]
- "process.env.bagel" = "'lox'"
  "bagel" = "lox" # only support strings

  # this should be implemented with plugins
  # and `preload`
- [loaders]
- ".bagel" = "js"

  [test]
- root = "test/bun.js" # too limited
+ matchers = [ "**/*[.|_][spec|test].{js|jsx|ts|tsx}" ]
+ logLevel = "debug" # overrides top-level logLevel



  [install]
+ logLevel = "debug" # overrides top-level logLevel

  registry = "https://registry.yarnpkg.com/"
  registry = "https://username:password@registry.yarnpkg.com/"

  # deprecate object form
  # there should be one right way to do things ideally
- registry = { url = "https://registry.yarnpkg.com/", token = "123456", username = "myusername", password = "mypassword" }


  production = "$NODE_ENV"
  dryRun = true
  optional = true
  dev = true
  peer = false

- globalDir = "~/.bun/install/global"
- globalBinDir = "~/.bun/bin"
+ [global]
+ dir = "~/.bun/install/global"
+ bin = "~/.bun/bin"

  # add separate section for autoinstall
- auto = true # true, false, force, fallback, disable
- prefer = "online" # online, offline, latest
+ [autoinstall]
+ disable = false
+ prefer = "online" # online, offline, latest
+ ttl = 86400

  # deprecate, object form only (see below)
- cache = true

  [install.cache]
  dir = "~/.bun/install/cache"

- disable = false
+ mode = "global" # global = use global cache, local = use node_modules/.cache
- disableManifest = false # these are basically the same
+ ttl = 300 # 0 = always check latest

  [install.lockfile]

- save = true # bad name
+ disable = false # defaults should always be false

- savePath = "bun.lockb"
+ path = "bun.lockb"

- print = "yarn" # terrible
+ external = [{
+   type: "yarn",
+   path: "yarn.lock",
+   version: 1 # eventually
+ }]


  [install.scopes]
  "@mybigcompany" = "https://registry.mybigcompany.com"

  # always require at sign
  # there should be one right way to do things
- "mybigcompany" = "https://registry.mybigcompany.com"

  "@mybigcompany5" = "https://username:password@registry.yarnpkg.com/"
  "@mybigcompany5" = "https://:$npm_token@registry.yarnpkg.com/"

  # drop object form
  # there should be one right way to do things
- "@mybigcompany" = { token = "123456", url = "https://registry.mybigcompany.com" }
- "mybigcompany" = { token = "123456", url = "https://registry.mybigcompany.com" }
- "@mybigcompany2" = { token = "$npm_config_token" }
- "@mybigcompany4" = { username = "myusername", password = "$npm_config_password", url = "https://registry.yarnpkg.com/" }
```
