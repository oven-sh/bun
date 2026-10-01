# Source sites of the twelve layers, read from the reference text.
# usage: sites.py faults|modes|writes|state|nodes
import re, sys
from zones import *
mode = sys.argv[1]
srcs = {}
def lines(f):
    src = srcs.setdefault(f['file'], open(REF + f['file'], encoding='utf-8').read().split('\n'))
    for i in range(f['decl'] - 1, f['end']):
        s = src[i].strip()
        if s.startswith('//'): continue
        yield i + 1, src[i], s
own = sorted([f for f in fns if f['mine']], key=lambda f: (f['file'], f['decl']))
if mode == 'faults':
    print('layer\tsite\tfunction\tkind\tstatement')
    for f in own:
        for n, l, s in lines(f):
            kind = None
            if re.search(r'\bpanic\(', l): kind = 'panic'
            elif re.search(r'debug\.(Assert\w*|Fail\w*)\(', l): kind = 'assert'
            elif re.search(r'\.\((\*?[A-Za-z_.]+)\)', l) and not s.startswith('func '): kind = 'cast'
            if kind: print('%s\t%s:%d\t%s\t%s\t%s' % (f['zone'], f['file'].split('/')[-1], n, short(f), kind, s[:200]))
if mode == 'modes':
    print('layer\tsite\tfunction\tstatement')
    for f in own:
        for n, l, s in lines(f):
            if s.startswith('func '): continue
            if re.search(r'CheckMode[A-Z]\w+', l) or re.search(r'checkMode ?[&|^]|[&|] ?\^?checkMode|argCheckMode', l):
                print('%s\t%s:%d\t%s\t%s' % (f['zone'], f['file'].split('/')[-1], n, short(f), s[:200]))
if mode == 'writes':
    print('layer\tsite\tfunction\tstore\tstatement')
    for f in own:
        store = {}
        for n, l, s in lines(f):
            m = re.search(r'(\w+) := c\.(\w+Links|nodeLinks)\.Get\(', l)
            if m: store[m.group(1)] = m.group(2)
            at = '%s\t%s:%d\t%s' % (f['zone'], f['file'].split('/')[-1], n, short(f))
            m = re.search(r'^\s*(\w+)\.(\w+(?:\.\w+)?) (\|?=|&\^=) ', l)
            if m and m.group(1) in store: print('%s\t%s\t%s' % (at, store[m.group(1)], s[:170]))
            m = re.search(r'c\.(\w+Links|nodeLinks)\.Get\([^)]*\)\.(\w+) (\|?=) ', l)
            if m: print('%s\t%s\t%s' % (at, m.group(1), s[:170]))
            m = re.search(r'c\.(\w+)\[[^\]]+\] = ', l)
            if m: print('%s\tmap %s\t%s' % (at, m.group(1), s[:170]))
if mode == 'state':
    # Statements that save, swap, push, pop or count a field of the checker or of a FlowState.
    print('layer\tsite\tfunction\tstatement')
    pat = re.compile(r'save\w+ :?=|= save\w+|c\.(push|pop)\w+\(|\bdefer\b|c\.(flowLoopStack|flowTypeCache|sharedFlows|antecedentTypes|contextualInfos|inferenceContextInfos|typeResolutions|resolutionStart|currentNode|instantiationCount|inlineLevel|flowAnalysisDisabled|flowInvocationCount|lastFlowNode|lastFlowNodeReachable|freeFlowState|withinUnreachableCode|reportedUnreachableNodes|resolvingExplicitTypeOfSymbol)\b[^=!]*(=[^=]|\+\+|--|\.Add|\.Delete|\.Clear)|f\.(depth|reduceLabels|refKey|sharedFlowStart)\b[^=!]*(=[^=]|\+\+|--)|links\.flags (\|=|&\^=)|links\.resolvedSignature = |links\.exhaustiveState = |cached := links')
    for f in own:
        for n, l, s in lines(f):
            if pat.search(l): print('%s\t%s:%d\t%s\t%s' % (f['zone'], f['file'].split('/')[-1], n, short(f), s[:200]))
if mode == 'nodes':
    # Nodes and flow nodes that the checker itself makes or changes.
    print('layer\tsite\tfunction\tstatement')
    pat = re.compile(r'c\.factory\.|createSyntheticExpression\(|&ast\.FlowNode\{|\.Loc = |\.Parent = \w+$|FlowNodeData\(\)\.FlowNode = ')
    for f in sorted(fns, key=lambda f: (f['file'], f['decl'])):
        if not f['file'].startswith('checker/'): continue
        src = srcs.setdefault(f['file'], open(REF + f['file'], encoding='utf-8').read().split('\n'))
        for i in range(f['decl'] - 1, f['end']):
            s = src[i].strip()
            if s.startswith('//') or s.startswith('func '): continue
            if pat.search(src[i]) and not re.search(r'(symbol|Symbol|result|merged|clone|prop|lateSymbol|newSymbol|metaPropertySymbol|attributeSymbol)\.Parent = ', src[i]):
                print('%s\t%s:%d\t%s\t%s' % (f['zone'], f['file'].split('/')[-1], i + 1, short(f), s[:200]))
if mode == 'eager':
    # core.IfElse, core.OrElse and core.Coalesce evaluate every argument: sites where an argument after the first holds a call.
    print('layer\tsite\tfunction\thelper\targuments after the first')
    for f in own:
        src = srcs.setdefault(f['file'], open(REF + f['file'], encoding='utf-8').read().split('\n'))
        text = '\n'.join(src[f['decl'] - 1:f['end']])
        for m in re.finditer(r'core\.(IfElse|OrElse|Coalesce)\(', text):
            depth = 0; args = []; cur = ''; i = m.end()
            while i < len(text):
                ch = text[i]
                if ch in '([{': depth += 1
                if ch in ')]}':
                    if depth == 0: break
                    depth -= 1
                if ch == ',' and depth == 0: args.append(cur); cur = ''
                else: cur += ch
                i += 1
            args.append(cur)
            rest = [' '.join(a.split()) for a in args[1:]]
            # a nested helper of the same family is not a call of its own
            if any(re.search(r'\b(?!core\.IfElse|core\.OrElse|core\.Coalesce)[\w.]+\(', a) for a in rest):
                line = f['decl'] + text[:m.start()].count('\n')
                print('%s\t%s:%d\t%s\t%s\t%s' % (f['zone'], f['file'].split('/')[-1], line, short(f), m.group(1), ' | '.join(rest)[:200]))
