# Publishing the Nix Environment

This document explains how to publish the Bun Nix development environment so users can download pre-built binaries instead of building from source.

## Overview

There are two main approaches to distributing the Nix flake:

1. **Direct from GitHub** - Users reference the flake URL (no binary cache)
2. **With Binary Cache** - Pre-built packages cached on Cachix or another cache

## Option 1: Direct from GitHub (No Binary Cache)

Users can use the flake directly from GitHub:

```bash
# Enter dev shell from GitHub
nix develop github:oven-sh/bun

# Or use it in a project
nix develop github:oven-sh/bun#default
```

**Pros:**
- Simple setup, no infrastructure needed
- Always up-to-date with latest flake changes

**Cons:**
- Users must build all dependencies themselves (slow first time)
- Nixpkgs binary cache helps, but still slower than custom cache

## Option 2: With Binary Cache (Cachix)

[Cachix](https://www.cachix.org/) is the easiest way to set up a binary cache for Nix.

### Setting Up Cachix

1. **Create a Cachix account** at https://app.cachix.org/

2. **Create a cache**:
   ```bash
   cachix create bun-dev
   ```

3. **Install Cachix CLI**:
   ```bash
   nix-env -iA cachix -f https://cachix.org/api/v1/install
   ```

4. **Authenticate**:
   ```bash
   cachix authtoken <YOUR_TOKEN>
   ```

### Building and Pushing to Cache

Build the development environment and push to Cachix:

```bash
# Build the dev shell for your platform
nix build .#devShells.$(nix eval --impure --raw --expr 'builtins.currentSystem').default

# Push to Cachix
cachix push bun-dev ./result
```

### For CI/CD (GitHub Actions)

Add this to your GitHub Actions workflow:

```yaml
- name: Install Cachix
  uses: cachix/cachix-action@v14
  with:
    name: bun-dev
    authToken: '${{ secrets.CACHIX_AUTH_TOKEN }}'

- name: Build and cache development environment
  run: |
    nix build .#devShells.x86_64-linux.default
    nix build .#devShells.aarch64-linux.default
    nix build .#devShells.x86_64-darwin.default
    nix build .#devShells.aarch64-darwin.default
```

Store your `CACHIX_AUTH_TOKEN` in GitHub Secrets.

### Users Consuming the Cache

Add this to the flake to automatically configure the cache:

```nix
{
  nixConfig = {
    extra-substituters = [
      "https://bun-dev.cachix.org"
    ];
    extra-trusted-public-keys = [
      "bun-dev.cachix.org-1:YOUR_PUBLIC_KEY"
    ];
  };
}
```

Or users can manually add it:

```bash
# Configure Cachix for this project
cachix use bun-dev

# Or add to their Nix config
nix develop github:oven-sh/bun --option extra-substituters "https://bun-dev.cachix.org" \
  --option extra-trusted-public-keys "bun-dev.cachix.org-1:YOUR_PUBLIC_KEY"
```

## Option 3: Self-Hosted Binary Cache

For more control, you can host your own binary cache.

### Using AWS S3

1. **Create S3 bucket**:
   ```bash
   aws s3 mb s3://bun-nix-cache
   ```

2. **Configure bucket policy** to allow public read access

3. **Sign derivations**:
   ```bash
   nix-store --generate-binary-cache-key cache.bun.sh secret.key public.key
   ```

4. **Build and sign**:
   ```bash
   nix build .#devShells.x86_64-linux.default
   nix copy --to 's3://bun-nix-cache?secret-key=secret.key' ./result
   ```

5. **Users configure**:
   ```nix
   {
     nixConfig = {
       extra-substituters = [ "s3://bun-nix-cache" ];
       extra-trusted-public-keys = [ "cache.bun.sh:YOUR_PUBLIC_KEY" ];
     };
   }
   ```

### Using Attic

[Attic](https://github.com/zhaofengli/attic) is a Nix-native binary cache:

```bash
# Start Attic server
attic-server

# Create cache
attic cache create bun-dev

# Push builds
nix build .#devShells.x86_64-linux.default
attic push bun-dev ./result
```

## Recommended Approach for Bun

### Phase 1: Direct GitHub Access (Now)

Start with direct GitHub access:

```bash
nix develop github:oven-sh/bun
```

This works immediately with no setup.

### Phase 2: Add Cachix (Later)

Once the flake is stable:

1. Create a Cachix cache named `bun-dev`
2. Add GitHub Actions to build and cache all platforms
3. Update `flake.nix` with `nixConfig` to auto-configure cache
4. Document in README

### Phase 3: Consider Self-Hosting (Optional)

If Cachix limits become an issue:
- Set up S3-based cache
- More control over caching infrastructure
- No third-party dependencies

## Multi-Platform Builds

To build for all platforms (requires remote builders):

```bash
# Build for all platforms
nix build .#devShells.x86_64-linux.default
nix build .#devShells.aarch64-linux.default
nix build .#devShells.x86_64-darwin.default
nix build .#devShells.aarch64-darwin.default

# Push all to cache
for result in result*; do
  cachix push bun-dev $result
done
```

### Setting Up Remote Builders

For building macOS on Linux (or vice versa), set up remote builders:

```nix
# ~/.config/nix/nix.conf or /etc/nix/nix.conf
builders = ssh://builder-macos x86_64-darwin,aarch64-darwin - 10 1 benchmark,big-parallel
           ssh://builder-linux x86_64-linux,aarch64-linux - 10 1 benchmark,big-parallel
```

## Monitoring Cache Usage

### Cachix

Dashboard at: https://app.cachix.org/cache/bun-dev

Shows:
- Storage usage
- Download bandwidth
- Cache hits/misses

### S3

Use AWS CloudWatch to monitor:
- Request counts
- Data transfer
- Storage costs

## Maintenance

### Garbage Collection

Regularly clean old builds from cache:

```bash
# Cachix (automatic, configurable)
# Settings at https://app.cachix.org/cache/bun-dev/settings

# S3 (use lifecycle policies)
aws s3api put-bucket-lifecycle-configuration --bucket bun-nix-cache --lifecycle-configuration file://lifecycle.json
```

### Updating Dependencies

When updating nixpkgs or dependencies:

```bash
# Update flake inputs
nix flake update

# Rebuild and push to cache
nix build .#devShells.x86_64-linux.default
cachix push bun-dev ./result
```

## Cost Estimates

### Cachix

- Free tier: 5 GB storage, 10 GB/month bandwidth
- Pro: $35/month - 50 GB storage, 500 GB/month bandwidth
- Enterprise: Custom pricing

For Bun development, Pro tier should be sufficient.

### AWS S3

Example costs for 100 GB storage + 1 TB/month transfer:
- Storage: ~$2.30/month
- Requests: ~$0.40/month
- Transfer (first 100 GB free): ~$80/month

Total: ~$83/month

### Recommendation

Start with Cachix free tier, upgrade to Pro if needed. S3 becomes cost-effective only at very high scale.

## Testing the Cache

Before announcing to users:

```bash
# Clear local cache
nix-collect-garbage -d

# Test download from cache
nix develop github:oven-sh/bun --refresh

# Should be much faster than building from source
```

## Documentation Updates

Once cache is set up, update:

1. **README.md** - Add quick start with cache
2. **NIX_SETUP.md** - Document cache configuration
3. **CONTRIBUTING.md** - Add Nix as development option

Example quick start:

```bash
# Install Nix with flakes enabled
sh <(curl -L https://nixos.org/nix/install) --daemon
echo "experimental-features = nix-command flakes" >> ~/.config/nix/nix.conf

# Enter Bun development environment (cached, fast!)
nix develop github:oven-sh/bun

# Build Bun
bun bd
```
