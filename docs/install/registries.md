The default registry is `registry.npmjs.org`. This can be globally configured in `bunfig.toml`:

```toml
[install]
# set default registry as a string
registry = "https://registry.npmjs.org"
# set a token
registry = { url = "https://registry.npmjs.org", token = "123456" }
# set a username/password
registry = "https://username:password@registry.npmjs.org"
```

To configure a private registry scoped to a particular organization:

```toml
[install.scopes]
# registry as string
"@myorg1" = "https://username:password@registry.myorg.com/"

# registry with username/password
# you can reference environment variables
"@myorg2" = { username = "myusername", password = "$NPM_PASS", url = "https://registry.myorg.com/" }

# registry with token
"@myorg3" = { token = "$npm_token", url = "https://registry.myorg.com/" }
```

### Changing the Mirror Source in Bun

To change the mirror source in Bun, you can configure the `bunfig.toml` file. Here are the steps:

1. Open the `bunfig.toml` file in your project directory. If it doesn't exist, create a new file named `bunfig.toml`.

2. Add the following configuration to set the mirror source:

```toml
[install]
# set the mirror source URL
registry = "https://your-mirror-source-url"
```

3. If your mirror source requires authentication, you can include the token or username/password:

```toml
[install]
# set the mirror source URL with token
registry = { url = "https://your-mirror-source-url", token = "your-token" }

# set the mirror source URL with username/password
registry = "https://username:password@your-mirror-source-url"
```

4. Save the `bunfig.toml` file.

For more detailed information on configuring the mirror source and other registry settings, refer to the [custom registry guide](../guides/install/custom-registry.md).

### Available Mirror Registry

Based on the discussion in #12936, here are some actual mirror sources that you can use:

- `https://registry.npmmirror.com`
- `https://mirrors.cloud.tencent.com/npm/`
- `https://repo.huaweicloud.com/repository/npm/`

### `.npmrc`

Bun does not currently read `.npmrc` files. For private registries, migrate your registry configuration to `bunfig.toml` as documented above.

---

<details>

<summary>
针对中国大陆的用户的配置指南
</summary>

由于中国特定的网络审查环境，npm 官方的注册表可能无法正常使用。以下是配置文档

### 更换镜像源

要在 Bun 中更换镜像源，可以配置 `bunfig.toml` 文件。以下是步骤：

1. 打开项目目录中的 `bunfig.toml` 文件。如果文件不存在，请创建一个名为 `bunfig.toml` 的新文件。

2. 添加以下配置以设置镜像源 URL：

```toml
[install]
# 设置镜像源 URL
registry = "https://your-mirror-source-url"
```

3. 如果您的镜像源需要身份验证，可以包含令牌或用户名/密码：

```toml
[install]
# 设置带有令牌的镜像源 URL
registry = { url = "https://your-mirror-source-url", token = "your-token" }

# 设置带有用户名/密码的镜像源 URL
registry = "https://username:password@your-mirror-source-url"
```

4. 保存 `bunfig.toml` 文件。

有关配置镜像源和其他注册表设置的详细信息，请参阅[自定义注册表指南](../guides/install/custom-registry.md)。

### 可用的镜像源

根据 #12936 中的讨论，以下是一些实际可用的镜像源：

- `https://registry.npmmirror.com`
- `https://mirrors.cloud.tencent.com/npm/`
- `https://repo.huaweicloud.com/repository/npm/`

</details>
