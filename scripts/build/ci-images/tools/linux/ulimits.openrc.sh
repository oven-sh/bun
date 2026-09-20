# OpenRC applies rc_ulimit to every service it starts, the agent included.
flags=
for flag in c d e f i l m q r s t v x; do
  flags="$flags -$flag unlimited"
done
echo "rc_ulimit=\"$flags -n $MAX_OPEN_FILES -u $MAX_PROCESSES\"" >> /etc/rc.conf
