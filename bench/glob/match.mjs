import { Glob } from "bun";
import { bench, run } from "../runner.mjs";


function benchPattern(name, glob, pattern) {
    bench(name, () => {
        new Glob(glob).match(pattern);
    })
}

benchPattern("max-depth" , "1{2,3{4,5{6,7{8,9{a,b{c,d{e,f{g,h{i,j{k,l}}}}}}}}}}m", "13579bdfhjlm");
benchPattern("non-ascii", "😎/¢£.{ts,tsx,js,jsx}", "😎/¢£.jsx");
benchPattern("utf8", "フォルダ/**/*", "フォルダ/aaa.js");
benchPattern("non-ascii+max-depth" , "1{2,3{4,5{6,7{8,😎{a,b{c,d{e,f{g,h{i,j{k,l}}}}}}}}}}m", "1357😎bdfhjlm");
benchPattern("pretty-average", "test/{foo/**,bar}/baz", "test/bar/baz");
benchPattern("pretty-average-2", "a/**/c/*.md", "a/bb.bb/aa/b.b/aa/c/xyz.md");
benchPattern("pretty-average-3", "a/b/**/c{d,e}/**/xyz.md", "a/b/cd/xyz.md");
benchPattern("pretty-average-4", "foo/bar/**/one/**/*.*", "foo/bar/baz/one/two/three/image.png");
benchPattern("long-pretty-average", "some/**/needle.{js,tsx,mdx,ts,jsx,txt}", "some/a/bigger/path/to/the/crazy/needle.txt");
benchPattern("brackets-lots", "f[^eiu][^eiu][^eiu][^eiu][^eiu]r", "foo-bar");


await run({
    min_max: true,
    percentiles: true,
    avg: true,
})
