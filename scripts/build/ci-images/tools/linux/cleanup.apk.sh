rm -rf /var/cache/apk/* /tmp/* /var/tmp/*
# Tells the disk which blocks are free, so the snapshot does not store them.
fstrim --all --verbose || true
