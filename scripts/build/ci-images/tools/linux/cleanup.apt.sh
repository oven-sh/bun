apt-get clean
rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*
# Tells the disk which blocks are free, so the snapshot does not store them.
fstrim --all --verbose || true
