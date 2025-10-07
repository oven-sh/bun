# Upgrading Bun's Self-Reported Node.js Version

This guide explains how to upgrade the Node.js version that Bun reports for compatibility with Node.js packages and native addons.

## Overview

Bun reports a Node.js version for compatibility with the Node.js ecosystem. This affects:
- `process.version` output
- Node-API (N-API) compatibility
- Native addon ABI compatibility
- V8 API compatibility for addons using V8 directly

## Files That Always Need Updates

### 1. Bootstrap Scripts
- `scripts/bootstrap.sh` - Update `NODEJS_VERSION=`
- `scripts/bootstrap.ps1` - Update `$NODEJS_VERSION =`

### 2. CMake Configuration
- `cmake/Options.cmake`
  - `NODEJS_VERSION` - The Node.js version string (e.g., "24.3.0")
  - `NODEJS_ABI_VERSION` - The ABI version number (find using command below)

### 3. Version Strings
- `src/bun.js/bindings/BunProcess.cpp`
  - Update `Bun__versions_node` with the Node.js version
  - Update `Bun__versions_v8` with the V8 version (find using command below)

### 4. N-API Version
- `src/napi/js_native_api.h`
  - Update `NAPI_VERSION` define (check Node.js release notes)

## Files That May Need Updates

Only check these if the build fails or tests crash after updating version numbers:
- V8 compatibility files in `src/bun.js/bindings/v8/` (if V8 API changed)
- Test files (if Node.js requires newer C++ standard)

## Quick Commands to Find Version Info

```bash
# Get latest Node.js version info
curl -s https://nodejs.org/dist/index.json | jq '.[0]'

# Get V8 version for a specific Node.js version (replace v24.3.0)
curl -s https://nodejs.org/dist/v24.3.0/node-v24.3.0-headers.tar.gz | tar -xzO node-v24.3.0/include/node/node_version.h | grep V8_VERSION

# Get ABI version for a specific Node.js version
curl -s https://nodejs.org/dist/v24.3.0/node-v24.3.0-headers.tar.gz | tar -xzO node-v24.3.0/include/node/node_version.h | grep NODE_MODULE_VERSION

# Or use the ABI registry
curl -s https://raw.githubusercontent.com/nodejs/node/main/doc/abi_version_registry.json | jq '.NODE_MODULE_VERSION."<version>"'
```

## Update Process

1. **Gather version info** using the commands above
2. **Update the required files** listed in the sections above
3. **Build and test**:
   ```bash
   bun bd
   bun bd -e "console.log(process.version)"
   bun bd -e "console.log(process.versions.v8)"
   bun bd test test/v8/v8.test.ts
   bun bd test test/napi/napi.test.ts
   ```

4. **Check for V8 API changes** only if build fails or tests crash:
   - Compare v8-function-callback.h between versions
   - Check v8-internal.h for Isolate size changes
   - Look for new required APIs in build errors

## If Build Fails or Tests Crash

The V8 API rarely has breaking changes between minor Node.js versions. If you encounter issues:
1. Check build errors for missing symbols or type mismatches
2. Compare V8 headers between old and new Node.js versions
3. Most issues can be resolved by implementing missing functions or adjusting structures

## Testing Checklist

- [ ] `process.version` returns correct version
- [ ] `process.versions.v8` returns correct V8 version  
- [ ] `process.config.variables.node_module_version` returns correct ABI
- [ ] V8 tests pass
- [ ] N-API tests pass

## Notes

- Most upgrades only require updating version numbers
- Major V8 version changes (rare) may require API updates
- The V8 shim implements only APIs used by common native addons