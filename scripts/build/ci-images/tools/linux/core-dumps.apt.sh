mkdir -p "$CORES_DIR"
chmod 1777 "$CORES_DIR"
echo "kernel.core_pattern = $CORES_DIR/%e-%p.core" >> /etc/sysctl.d/local.conf
# Ubuntu's crash reporter would take the cores instead.
if systemctl list-unit-files apport.service | grep -q apport; then
  systemctl disable apport.service
fi
apt-get install --yes --no-install-recommends gdb
# The test runner reads the pattern back with `sysctl`, as the agent's user, and
# Debian gives a user who is not root no sbin directory on PATH.
add_to_path /sbin
