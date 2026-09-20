mkdir -p "$CORES_DIR"
chmod 1777 "$CORES_DIR"
mkdir -p /etc/sysctl.d
echo "kernel.core_pattern = $CORES_DIR/%e-%p.core" >> /etc/sysctl.d/local.conf
apk add --no-cache --no-interactive --no-progress gdb
# The test runner reads the pattern back with `sysctl`, as the agent's user, and
# Debian gives a user who is not root no sbin directory on PATH.
add_to_path /sbin
