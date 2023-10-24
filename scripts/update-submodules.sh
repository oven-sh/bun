
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
cd ../..
NAMES=$(cat .gitmodules | grep 'path = ' | awk '{print $3}')

# we will exclude webkit unless you explicity clone it yourself (a huge download)
if [ ! -e "src/bun.js/WebKit/.git" ]; then
  NAMES=$(echo "$NAMES" | grep -v 'WebKit')
fi

set -euxo pipefail
git submodule update --init --recursive --progress --depth=1 --checkout $NAMES