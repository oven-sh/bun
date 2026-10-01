const ts=require('/workspace/wt/parser/node_modules/typescript');
const inputs=require(process.argv[2]);
for(const [loader,code] of inputs){
  const kind=loader==='tsx'?ts.ScriptKind.TSX:loader==='ts'?ts.ScriptKind.TS:loader==='jsx'?ts.ScriptKind.JSX:ts.ScriptKind.JS;
  const sf=ts.createSourceFile('a.'+loader,code,ts.ScriptTarget.ESNext,true,kind);
  const d=sf.parseDiagnostics.map(x=>`TS${x.code}@${x.start}+${x.length} ${ts.flattenDiagnosticMessageText(x.messageText,' ')}`);
  console.log(JSON.stringify({loader,code,tsc:d}));
}
