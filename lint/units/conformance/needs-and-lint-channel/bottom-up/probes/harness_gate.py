# What the command line's rule (internal/compiler/program.go:1970 and :1979) drops of what the harness collects.
# Reads the programs that the reference built for the 12,797 run instances (research of the unit typecheck).
import gzip, json, sys
path = sys.argv[1] if len(sys.argv) > 1 else '/workspace/notes/lint/units/typecheck/drivers-k4-k5/bottom-up/data/manifest.jsonl.gz'
rows = [json.loads(l) for l in gzip.open(path, 'rt')]
def n(r, k): return len(r['diag'].get(k) or [])
others = ['config', 'program', 'bind', 'semantic', 'global', 'include', 'declaration', 'suggestion']
syn = [r for r in rows if n(r, 'syntactic') > 0]
print(json.dumps({
    'runInstances': len(rows),
    'withErrors': sum(1 for r in rows if r['used'] > 0),
    'preEmitCountDiffersFromPostEmit': sum(1 for r in rows if r['pre'] != r['post']),
    'withSyntactic': len(syn),
    'syntacticAndSomethingDroppedAt1970': sum(1 for r in syn if n(r, 'program') + n(r, 'bind') + n(r, 'semantic') + n(r, 'global') + n(r, 'declaration') > 0),
    'syntacticAndBindSemanticOrGlobal': sum(1 for r in syn if n(r, 'bind') + n(r, 'semantic') + n(r, 'global') > 0),
    'noSyntacticProgramOrGlobalAndSemanticDroppedAt1979': sum(1 for r in rows if n(r, 'syntactic') == 0 and n(r, 'program') + n(r, 'global') > 0 and n(r, 'bind') + n(r, 'semantic') > 0),
    'onlySyntactic': sum(1 for r in syn if all(n(r, k) == 0 for k in others)),
    'exactlyOneSyntacticAndNothingElse': sum(1 for r in syn if n(r, 'syntactic') == 1 and all(n(r, k) == 0 for k in others)),
    'oneFileBesideTheLibraries': sum(1 for r in rows if len(r['files'] or []) == 1),
    'noEmitTrue': sum(1 for r in rows if r['options'].get('noEmit') == 2),
    'byOrigin': {k: sum(1 for r in rows if n(r, k) > 0) for k in ['config', 'program', 'syntactic', 'bind', 'semantic', 'include', 'global']},
}))
