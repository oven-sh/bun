FROM ghcr.io/oven-sh/bun-development-docker-image:prebuilt

# Create a non-root user for development
RUN useradd -m -s /bin/bash ubuntu

# Create workspace directory and give ubuntu user access
RUN mkdir -p /workspace && \
    chown -R ubuntu:ubuntu /workspace && \
    # Allow ubuntu user to use sudo without password for development tasks
    apt-get update && apt-get install -y sudo && \
    echo "ubuntu ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers && \
    rm -rf /var/lib/apt/lists/*

# Set the user and working directory
USER ubuntu
WORKDIR /workspace/bun

# Configure Git for the ubuntu user (agents often need this)
RUN git config --global user.name "Background Agent" && \
    git config --global user.email "agent@cursor.com" && \
    git config --global init.defaultBranch main

# Ensure PATH includes Bun binaries for the ubuntu user
ENV PATH="/workspace/bun/build/debug:/workspace/bun/build/release:/usr/local/bin:${PATH}"

RUN git pull