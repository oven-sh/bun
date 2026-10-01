const ts=require('/workspace/wt/parser/node_modules/typescript');
const inputs=[
 ["ts","/// <reference path=\"a.d.ts\" />\n/// <reference types=\"node\" />\n/// <reference lib=\"es2015\" />\nlet x;"],
 ["ts","/// <reference types=\"node\" resolution-mode=\"import\" preserve=\"true\"/>\nlet x;"],
 ["ts","/// <reference types=\"node\" resolution-mode=\"bogus\"/>\nlet x;"],
 ["ts","/// <reference no-default-lib=\"true\"/>\nlet x;"],
 ["ts","/// <reference no-default-lib=\"false\"/>\nlet x;"],
 ["ts","/// <reference foo=\"bar\"/>\nlet x;"],
 ["ts","/// <reference path='a.ts'>\nlet x;"],
 ["ts","/// <reference path=a.ts />\nlet x;"],
 ["ts","///<reference path=\"a.ts\"/>\nlet x;"],
 ["ts","///  <REFERENCE PATH=\"a.ts\"/>\nlet x;"],
 ["ts","// <reference path=\"a.ts\"/>\nlet x;"],
 ["ts","//// <reference path=\"a.ts\"/>\nlet x;"],
 ["ts","/// <reference path=\"a.ts\" path=\"b.ts\"/>\nlet x;"],
 ["ts","/// <reference path=\"a.ts\" types=\"t\" lib=\"l\"/>\nlet x;"],
 ["ts","/// <reference path = \"a.ts\"  />\nlet x;"],
 ["ts","/// <reference\tpath=\"a.ts\"/>\nlet x;"],
 ["ts","/// <referencepath=\"a.ts\"/>\nlet x;"],
 ["ts","/// <reference-x path=\"a.ts\"/>\nlet x;"],
 ["ts","/// <reference path=\"a.ts\"\nlet x;"],
 ["ts","/// <reference path=\"unterminated />\nlet x;"],
 ["ts","/// <reference />\nlet x;"],
 ["ts","/// <amd-module name=\"m\"/>\n/// <amd-dependency path=\"p\" name=\"n\"/>\nlet x;"],
 ["ts","let x;\n/// <reference path=\"late.ts\"/>\n"],
 ["ts","#!/usr/bin/env node\n/// <reference path=\"a.ts\"/>\nlet x;"],
 ["ts","\n\n   /// <reference path=\"a.ts\"/>\n/* c */ /// <reference path=\"b.ts\"/>\nlet x;"],
 ["ts","/* block */\n/// <reference path=\"a.ts\"/>\n\"use strict\";\n/// <reference path=\"b.ts\"/>\n"],
 ["ts","// @ts-nocheck\nlet x;"],
 ["ts","// @ts-check\n// @ts-nocheck\nlet x;"],
 ["ts","// @ts-nocheck\n// @ts-check\nlet x;"],
 ["ts","//@ts-nocheck\nlet x;"],
 ["ts","//   @TS-NoCheck   trailing text\nlet x;"],
 ["ts","/// @ts-nocheck\nlet x;"],
 ["ts","/* @ts-nocheck */\nlet x;"],
 ["ts","// foo @ts-nocheck\nlet x;"],
 ["ts","// @ts-nocheckx\nlet x;"],
 ["ts","// @ts-nocheck-x\nlet x;"],
 ["ts","let x;\n// @ts-nocheck\n"],
 ["ts","// @ts-ignore\nlet x: number = 'a';\n/* @ts-expect-error */\nlet y;\n/*\n * a\n * @ts-ignore */\nlet z;"],
 ["tsx","/** @jsx h */\n/* @jsxFrag Fragment */\n/* @jsxImportSource preact\n @jsxRuntime automatic */\nlet x;"],
 ["tsx","// @jsx h\nlet x;"],
 ["tsx","/* a@b.c @jsx h */\nlet x;"],
 ["tsx","/* @JSX   h   extra */\nlet x;"],
 ["tsx","/* @jsx */\nlet x;"],
 ["tsx","/* @jsx\n h */\nlet x;"],
 ["tsx","/* @jsx h\u2028@jsxFrag F */\nlet x;"],
 ["ts","/// <reference path=\"a.ts\"/> trailing\nlet x;"],
 ["ts","/// <reference path=\"a.ts\" /> <reference path=\"b.ts\" />\nlet x;"],
 ["ts","///\t<reference path=\"\"/>\nlet x;"],
 ["ts","/// <reference types=\"a\" preserve=\"false\"/>\n/// <reference lib=\"b\" preserve=\"true\"/>\n/// <reference path=\"c\" preserve=\"true\"/>\nlet x;"],
 ["ts","\ufeff/// <reference path=\"a.ts\"/>\nlet x;"],
 ["ts","/// <reference path=\"a.ts\"/>\r\n/// <reference path=\"b.ts\"/>\r\nlet x;"],
 ["ts","/* unterminated /// <reference path=\"a.ts\"/>"],
 ["ts","/// <reference types=\"node\" resolution-mode=\"require\"/>\n/// <reference path=\"x\" resolution-mode=\"bogus\"/>\nlet x;"]
];
const j=(x)=>JSON.stringify(x);
for(const [loader,code] of inputs){
  const kind=loader==='tsx'?ts.ScriptKind.TSX:ts.ScriptKind.TS;
  const sf=ts.createSourceFile('a.'+loader,code,ts.ScriptTarget.ESNext,true,kind);
  const fr=(a)=>a.map(r=>`${r.fileName}@${r.pos}-${r.end}${r.resolutionMode!==undefined?' mode='+r.resolutionMode:''}${r.preserve?' preserve':''}`);
  const prag=[...sf.pragmas.entries()].map(([k,v])=>k+':'+j(Array.isArray(v)?v.map(e=>({args:e.arguments,pos:e.range.pos,end:e.range.end})):{args:v.arguments,pos:v.range.pos,end:v.range.end}));
  console.log(j(code));
  console.log('  ref='+j(fr(sf.referencedFiles))+' types='+j(fr(sf.typeReferenceDirectives))+' lib='+j(fr(sf.libReferenceDirectives))+' checkJs='+j(sf.checkJsDirective&&{enabled:sf.checkJsDirective.enabled,pos:sf.checkJsDirective.pos,end:sf.checkJsDirective.end})+' noDefaultLib='+sf.hasNoDefaultLib+' amd='+j(sf.amdDependencies)+' moduleName='+j(sf.moduleName));
  console.log('  pragmas='+prag.join(' ; '));
  console.log('  directives='+j((sf.commentDirectives||[]).map(d=>({pos:d.range.pos,end:d.range.end,type:d.type})))+' diags='+j(sf.parseDiagnostics.map(x=>`TS${x.code}@${x.start}+${x.length}`)));
}
