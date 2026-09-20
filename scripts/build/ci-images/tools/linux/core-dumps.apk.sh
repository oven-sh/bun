mkdir -p "$CORES_DIR"
chmod 1777 "$CORES_DIR"
mkdir -p /etc/sysctl.d
echo "kernel.core_pattern = $CORES_DIR/%e-%p.core" >> /etc/sysctl.d/local.conf
apk add --no-cache --no-interactive --no-progress gdb

gdb --version | head -n1
