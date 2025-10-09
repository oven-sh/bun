FROM nixos/nix:latest

# Enable flakes
RUN mkdir -p /etc/nix && \
    echo "experimental-features = nix-command flakes" >> /etc/nix/nix.conf

# Copy flake files
WORKDIR /workspace/bun
COPY flake.nix flake.lock ./

# Pre-build the development environment to cache dependencies
RUN nix develop --command echo "Environment built"

# Copy the rest of the source
COPY . .

# Default command enters the dev shell
CMD ["nix", "develop"]
