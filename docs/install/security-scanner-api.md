Bun's package manager includes a Security Scanner API that allows scanning packages for security vulnerabilities before installation, helping protect your applications from supply chain attacks and known vulnerabilities.

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
- Supply chain attacks
- Suspicious package behaviors
- Outdated dependencies with known issues

### Integration with Package Installation

The Security Scanner API integrates seamlessly with Bun's package installation process:

1. **Pre-installation scanning**: Packages are scanned before being added to your project
2. **Dependency tree analysis**: Entire dependency chains are evaluated for security issues
3. **Real-time vulnerability database**: Scanners can query up-to-date vulnerability databases
4. **Policy enforcement**: Custom security policies can be enforced across installations

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

- [Configuration (bunfig.toml)](/docs/runtime/bunfig#install-security-scanner)
- [Package Manager](/docs/install)
- [Security Scanner Template](https://github.com/oven-sh/security-scanner-template)
