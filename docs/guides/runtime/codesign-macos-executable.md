---
name: Codesign a single-file JavaScript executable on macOS
---

Codesigning on macOS is required to avoid Gatekeeper warnings when running your executable.

The first step is to compile your executable using the `--compile` flag:

```sh
$ bun build --compile ./path/to/entry.ts --outfile myapp
```

---

List your available signing identities. One of these will be your signing identity that you pass to the `codesign` command. This command requires macOS.

{% note %}

Pass the part in `()` after `"Developer ID Application: Your Name ("` in the example above to the `--sign` flag in the `codesign` command.

{% /note %}

```sh
$ security find-identity -v -p codesigning
1. XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX "Developer ID Application: Your Name (ZZZZZZZZZZ)"
   1 valid identities found
```

---

Optional, but recommended: create an `entitlements.plist` file with the necessary permissions for the JavaScript engine to work correctly.

```xml#entitlements.plist
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.disable-executable-page-protection</key>
    <true/>
    <key>com.apple.security.cs.allow-dyld-environment-variables</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
</dict>
</plist>
```

---

Sign your executable using the `codesign` command:

```bash
$ codesign --entitlements entitlements.plist -vvvv --deep --sign "YOUR_SIGNING_ID_FROM_SECURITY_FIND_IDENTITY" ./myapp --force
```

Replace `YOUR_SIGNING_ID_FROM_SECURITY_FIND_IDENTITY` with your actual signing identity from the list.

---

Verify that the executable has been properly signed:

```bash
$ codesign -vvv --verify ./myapp
```

---

For more information on macOS codesigning, refer to [Apple's Code Signing documentation](https://developer.apple.com/documentation/security/code_signing_services).

For details about creating single-file executables with Bun, see [Standalone Executables](/docs/bundler/executables).

This guide requires Bun v1.2.4 or newer.
