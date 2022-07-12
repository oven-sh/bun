#!/bin/bash
set -euo pipefail

if [ -f src/northwind.sqlite ]; then
  exit 0
fi

curl -LJO https://raw.githubusercontent.com/jpwhite3/northwind-SQLite3/master/Northwind_large.sqlite.zip

unzip Northwind_large.sqlite.zip

rm Northwind_large.sqlite.zip
mv Northwind_large.sqlite src/northwind.sqlite

rm -rf __MACOSX
rm -rf Northwind* || echo ""