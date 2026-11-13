#!/bin/bash
# Pushes the files of /tmp/notes and /tmp/measure/*.py|*.sh|*.ts as one orphan commit to refs/wip/a8fe191a/notes.
cd /workspace/bun || exit 1
entries=""
for f in /tmp/notes/* /tmp/measure/*.py /tmp/measure/*.sh /tmp/measure/*.ts /tmp/matrix/*.ts /tmp/probe/*.sh; do
  [ -f "$f" ] || continue
  blob=$(git hash-object -w "$f")
  name=$(echo "$f" | sed 's|^/tmp/||; s|/|__|g')
  entries="${entries}100644 blob ${blob}\t${name}\n"
done
tree=$(printf "$entries" | git mktree)
commit=$(git -c user.name=robobun -c user.email=robobun@bun.sh commit-tree "$tree" -m "notes")
git push -q -f origin "$commit:refs/wip/a8fe191a/notes" && echo "backed up $commit"
