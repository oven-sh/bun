set -e

rm reproduction -rf
mkdir reproduction

cd src
find . -type f -name "*.zig" ! -path "./deps/WebKit/*" ! -path "./deps/zig/*" | while IFS= read -r file; do
  echo "$file"
  mkdir -p ../reproduction/src/$(dirname "$file")
  cp "$file" ../reproduction/src/"$file"
  cp ../root.zig 
done
