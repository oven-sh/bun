export DEBIAN_FRONTEND=noninteractive
apt-get update --yes
# PACKAGES is a list of names: splitting it is the point.
# shellcheck disable=SC2086
apt-get install --yes --no-install-recommends $PACKAGES
