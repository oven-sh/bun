limits=/etc/security/limits.d/99-unlimited.conf
mkdir -p /etc/security/limits.d
for limit in core data fsize memlock nofile rss stack cpu nproc as locks sigpending msgqueue; do
  case "$limit" in
    nofile) value=$MAX_OPEN_FILES ;;
    nproc) value=$MAX_PROCESSES ;;
    *) value=unlimited ;;
  esac
  for who in root '*'; do
    echo "$who soft $limit $value" >> "$limits"
    echo "$who hard $limit $value" >> "$limits"
  done
  # systemd says "infinity" where limits.conf says "unlimited".
  [ "$value" = unlimited ] && value=infinity
  echo "DefaultLimit$(echo "$limit" | tr '[:lower:]' '[:upper:]')=$value" >> /etc/systemd/system.conf
done
for pam in /etc/pam.d/common-session /etc/pam.d/common-session-noninteractive; do
  echo "session optional pam_limits.so" >> "$pam"
done
