#!/bin/bash
set -euo pipefail

if [ -f src/northwind.sqlite ]; then
  exit 0
fi

curl -LJO https://raw.githubusercontent.com/jpwhite3/northwind-SQLite3/46d5f8a64f396f87cd374d1600dbf521523980e8/Northwind_large.sqlite.zip

unzip Northwind_large.sqlite.zip

rm Northwind_large.sqlite.zip
mv Northwind_large.sqlite src/northwind.sqlite

rm -rf __MACOSX
rm -rf Northwind* || echo ""
