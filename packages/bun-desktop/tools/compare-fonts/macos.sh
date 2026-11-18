#!/bin/sh
# What `compare_fonts` says about the fonts that macOS uses for its interface, and then what matters about the rest.
# Run it where the executable is.
fonts=/System/Library/Fonts
set --
for name in SFNS SFArabic SFHebrew NewYork Menlo Monaco Helvetica Times Courier "Apple Color Emoji" "Apple Symbols" CJKSymbolsFallback \
  AppleSDGothicNeo "Hiragino Sans GB" GeezaPro Kohinoor Thonburi LucidaGrande Symbol ZapfDingbats; do
  set -- "$@" "$fonts/$name"*
done
set -- "$@" "$fonts/"*" W3.ttc" $(find /System/Library -name "PingFang*.ttc" 2>/dev/null)
./compare_fonts "$@"
echo "== all fonts"
./compare_fonts "$fonts" > compare_fonts.txt
grep -A4 -E "^/|words|agrees with harfrust|against Core Text|1/16|advances|panics" compare_fonts.txt | grep -v -E "^--|vertical|lacks extents"
