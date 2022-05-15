#!/bin/bash
set -euo pipefail

rm -rf Northwind_large.sqlite.zip
wget https://github.com/jpwhite3/northwind-SQLite3/blob/master/Northwind_large.sqlite.zip
unzip Northwind_large.sqlite.zip
rm Northwind_large.sqlite.zip
mv Northwind_large.sqlite /tmp/northwind.sqlite
