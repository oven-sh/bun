# Adds the recording calls to the COPY of checker.go inside the probe module. Never run on the reference.
import sys
p = sys.argv[1]
s = open(p).read()
def rep(a, b):
    global s
    if a not in s:
        sys.exit("pattern not found: " + a[:60])
    s = s.replace(a, b, 1)
rep("\tt.checker = c\n\tt.data = data\n", "\tt.checker = c\n\tt.data = data\n\tprobeRecordType(c, t)\n")
rep("\tresult.Flags = flags | ast.SymbolFlagsTransient\n\tresult.Name = name\n\treturn result\n", "\tresult.Flags = flags | ast.SymbolFlagsTransient\n\tresult.Name = name\n\tprobeRecordSymbol(c, result)\n\treturn result\n")
rep("func (c *Checker) initializeClosures() {\n", "func (c *Checker) initializeClosures() {\n\tprobeMark(c, \"after inline part of NewChecker (line 1117)\")\n")
rep("func (c *Checker) initializeChecker() {\n", "func (c *Checker) initializeChecker() {\n\tprobeMark(c, \"start of initializeChecker\")\n\tdefer probeMark(c, \"end of initializeChecker\")\n")
rep("\tc.addUndefinedToGlobalsOrErrorOnRedeclaration()\n\tc.valueSymbolLinks.Get(c.undefinedSymbol)", "\tprobeMark(c, \"after global merge and global augmentations (line 1349)\")\n\tc.addUndefinedToGlobalsOrErrorOnRedeclaration()\n\tc.valueSymbolLinks.Get(c.undefinedSymbol)")
rep("\t// Now merge global ambient module declarations\n", "\tprobeMark(c, \"after special types (line 1376)\")\n\t// Now merge global ambient module declarations\n")
open(p, 'w').write(s)
