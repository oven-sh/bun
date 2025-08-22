Bun's package manager can scan packages for security vulnerabilities before installation, helping protect your applications from supply chain attacks and known vulnerabilities.

## Quick Start

Configure a security scanner in your `bunfig.toml`:

```toml
[install.security]
scanner = "@acme/bun-security-scanner"
```

When configured, Bun will:

- Scan all packages before installation
- Display security warnings and advisories
- Cancel installation if critical vulnerabilities are found
- Automatically disable auto-install for security

## How It Works

Security scanners analyze packages during `bun install`, `bun add`, and other package operations. They can detect:

- Known security vulnerabilities (CVEs)
- Malicious packages
- License compliance issues
- ...and more!

### Security Levels

Scanners report issues at two severity levels:

- **`fatal`** - Installation stops immediately, exits with non-zero code
- **`warn`** - In interactive terminals, prompts to continue; in CI, exits immediately

## Using Pre-built Scanners

Many security companies publish Bun security scanners as npm packages that you can install and use immediately.

### Installing a Scanner

Install a security scanner from npm:

```bash
$ bun add -d @acme/bun-security-scanner
```

> **Note:** Consult your security scanner's documentation for their specific package name and installation instructions. Most scanners will be installed with `bun add`.

### Configuring the Scanner

After installation, configure it in your `bunfig.toml`:

```toml
[install.security]
scanner = "@acme/bun-security-scanner"
```

### Enterprise Configuration

Some enterprise scanners might support authentication and/or configuration through environment variables:

```bash
# This might go in ~/.bashrc, for example
export SECURITY_API_KEY="your-api-key"

# The scanner will now use these credentials automatically
bun install
```

Consult your security scanner's documentation to learn which environment variables to set and if any additional configuration is required.

### Authoring your own scanner

For a complete example with tests and CI setup, see the official template:
[github.com/oven-sh/security-scanner-template](https://github.com/oven-sh/security-scanner-template)

## Related

- [Configuration (bunfig.toml)](/docs/runtime/bunfig#installsecurityscanner)
- [Package Manager](/docs/install)
- [Security Scanner Template](https://github.com/oven-sh/security-scanner-template)
