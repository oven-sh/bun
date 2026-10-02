#!/bin/sh
# usage: cmp.sh <cases.json>
BASE=/workspace/base/bun.f4d755a9c
HEAD=/workspace/head/bun.head
$BASE $(dirname "$0")/run.mjs "$1" > $(dirname "$0")/out.base.jsonl 2>&1
$HEAD $(dirname "$0")/run.mjs "$1" > $(dirname "$0")/out.head.jsonl 2>&1
$BASE -e '
const fs=require("fs");
const a=fs.readFileSync("$(dirname "$0")/out.base.jsonl","utf8").trim().split("\n").map(JSON.parse);
const b=fs.readFileSync("$(dirname "$0")/out.head.jsonl","utf8").trim().split("\n").map(JSON.parse);
for(let i=0;i<a.length;i++){const x=a[i],y=b[i];
 const fx=x.ok?"A "+JSON.stringify(x.out):"R "+x.err; const fy=y.ok?"A "+JSON.stringify(y.out):"R "+y.err;
 const same = fx===fy;
 console.log((same?"SAME ":"DIFF ")+"["+x.loader+"] "+JSON.stringify(x.source)+"\n      base: "+fx+(same?"":"\n      head: "+fy));
}'
