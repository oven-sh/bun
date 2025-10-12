# Yarn Berry (v2+) Migration - Documentation Index

**Date**: October 2025  
**Status**: ✅ Research Complete, Ready for Implementation

---

## 📚 Documentation Structure

This directory contains comprehensive research and planning for implementing Yarn Berry (v2+) lockfile migration to bun.lock.

### Documents Overview

1. **[YARN_BERRY_RESEARCH.md](YARN_BERRY_RESEARCH.md)** (118 KB)
   - **Purpose**: Complete technical specification
   - **Audience**: Implementers, technical reviewers
   - **Content**:
     - Full format specification
     - All protocols with examples
     - Virtual packages deep dive
     - Migration architecture
     - Complete test plan (20+ test cases)
   - **Read this**: For deep understanding of Berry format

2. **[YARN_BERRY_IMPLEMENTATION_PLAN.md](YARN_BERRY_IMPLEMENTATION_PLAN.md)** (30 KB)
   - **Purpose**: Implementation roadmap
   - **Audience**: Implementers, project managers
   - **Content**:
     - 4-phase implementation strategy
     - Key technical decisions
     - Code structure and architecture
     - Risk assessment
     - Success criteria
   - **Read this**: Before starting implementation

3. **[YARN_BERRY_QUICK_REF.md](YARN_BERRY_QUICK_REF.md)** (7 KB)
   - **Purpose**: Quick lookup reference
   - **Audience**: Developers during implementation
   - **Content**:
     - Protocol cheat sheet
     - Code patterns
     - Common gotchas
     - MVP checklist
   - **Read this**: While coding

4. **[YARN_REWRITE_FINDINGS.md](YARN_REWRITE_FINDINGS.md)** (36 KB)
   - **Purpose**: Yarn v1 implementation notes
   - **Audience**: Reference for comparison
   - **Content**:
     - v1 architecture
     - v1 vs Berry differences
     - Lessons learned from v1
   - **Read this**: For context on existing v1 code

---

## 🎯 Quick Start Guide

### For Implementers

**Day 1-2: Understand the format**

1. Read [Quick Reference](YARN_BERRY_QUICK_REF.md) (30 min)
2. Skim [Research Document](YARN_BERRY_RESEARCH.md) sections 1-7 (2 hours)
3. Read [Implementation Plan](YARN_BERRY_IMPLEMENTATION_PLAN.md) (1 hour)

**Day 3-7: Implement Phase 1 MVP**

1. Create test fixtures (Day 3)
2. Implement YAML parsing (Day 4)
3. Implement npm: and workspace: protocols (Day 5)
4. Implement package creation and resolution (Day 6)
5. Test and debug (Day 7)

**Day 8-10: Implement Phase 2**

- Add remaining protocols (link:, portal:, file:, git:, github:, https:)

**Day 11-17: Implement Phase 3-4**

- Advanced features (patches, virtual packages)
- Polish and edge cases

### For Reviewers

1. Read [Implementation Plan](YARN_BERRY_IMPLEMENTATION_PLAN.md) (1 hour)
2. Review "Key Technical Decisions" section
3. Check test coverage against test plan
4. Verify error handling matches specification

### For Project Managers

1. Read "Executive Summary" in [Research Document](YARN_BERRY_RESEARCH.md) (10 min)
2. Read "Implementation Phases" in [Implementation Plan](YARN_BERRY_IMPLEMENTATION_PLAN.md) (15 min)
3. Note: 11-17 days estimated effort, medium-high priority

---

## 🔑 Key Findings Summary

### Format Differences from v1

| Aspect    | Yarn v1                  | Yarn Berry                  |
| --------- | ------------------------ | --------------------------- |
| Format    | YAML-like (custom)       | Valid YAML                  |
| Parser    | Custom indentation-based | Standard YAML library       |
| Protocols | Implicit (rare)          | Explicit (always)           |
| Entry key | `"pkg@^1.0.0"`           | `"pkg@npm:^1.0.0"`          |
| Integrity | `integrity: sha512-...`  | `checksum: 10c0/...`        |
| Workspace | Unreliable markers       | `@workspace:` protocol      |
| Patches   | Not supported            | `patch:` protocol           |
| Peer deps | Not recorded             | Recorded + virtual packages |

### Cannot Reuse from v1

- ❌ Parser (completely different format)
- ❌ Entry parsing (different structure)
- ❌ Protocol handling (all deps have protocols now)
- ❌ Integrity parsing (different format)

### Can Reuse from v1

- ✅ Workspace glob matching
- ✅ Package.json reading
- ✅ bun.lock generation
- ✅ Dependency resolution architecture
- ✅ String buffer management
- ✅ Metadata fetching (os/cpu)

---

## 📋 Implementation Checklist

### Phase 1: MVP (3-5 days)

- [ ] Create `src/install/yarn_berry.zig`
- [ ] Parse YAML with `bun.interchange.yaml.YAML`
- [ ] Extract and validate `__metadata` (version ≥ 6)
- [ ] Implement `npm:` protocol parsing
- [ ] Implement `workspace:` protocol parsing
- [ ] Convert checksums (`10c0/hash` → `sha512-hash`)
- [ ] Handle multi-spec entries
- [ ] Skip virtual packages (with warning)
- [ ] Skip patches (with warning, use base package)
- [ ] Parse dependencies (strip protocol prefixes)
- [ ] Create root + workspace packages
- [ ] Create regular packages
- [ ] Resolve dependencies
- [ ] Fetch metadata (os/cpu from npm)
- [ ] Create test fixtures in `test/cli/install/migration/yarn-berry/`
- [ ] Write tests (Tests 1-4 from test plan)

### Phase 2: Common Protocols (2-3 days)

- [ ] Implement `link:` protocol
- [ ] Implement `portal:` protocol
- [ ] Implement `file:` protocol (tarball vs folder)
- [ ] Implement `git:` protocol
- [ ] Implement `github:` protocol
- [ ] Implement `https:` protocol (remote tarballs)
- [ ] Write tests (Tests 5-10)

### Phase 3: Advanced Features (4-6 days)

- [ ] Implement full `patch:` protocol support
  - [ ] Read `.yarn/patches/` directory
  - [ ] Parse patch descriptors (URL decoding)
  - [ ] Store in Bun patch format
- [ ] Implement virtual package support (flatten or full)
- [ ] Implement resolutions/overrides
- [ ] Handle `dependenciesMeta` (optional flags)
- [ ] Handle peer dependency metadata
- [ ] Write tests (Tests 11-15)

### Phase 4: Polish (2-3 days)

- [ ] Improve error messages
- [ ] Handle edge cases (Tests 16-20)
- [ ] Performance optimization
- [ ] Documentation
- [ ] Integration tests with real projects

### Integration

- [ ] Update `src/install/migration.zig` to detect Berry
- [ ] Add `yarn_berry` to `migrated` enum in `lockfile.zig`
- [ ] Add analytics tracking
- [ ] Update migration error handling

---

## 📊 Test Plan Overview

### Test Categories

**Must Have (Phase 1)**

1. Simple npm dependencies
2. Workspace dependencies
3. Multi-spec consolidation
4. Scoped packages

**Should Have (Phase 2)** 5. Link protocol 6. Portal protocol 7. File dependencies 8. Git dependencies 9. GitHub shorthand 10. HTTPS remote tarballs

**Nice to Have (Phase 3)** 11. Patch protocol (full support) 12. Virtual packages (flatten or full) 13. Resolutions/overrides 14. Optional dependencies 15. Peer dependencies

**Edge Cases (Phase 4)** 16. URL encoding in patches 17. Very long package names 18. Mixed protocols 19. Missing fields 20. Invalid lockfile version

---

## 🚨 Key Technical Decisions

### 1. Virtual Packages

**Decision**: Skip in MVP, flatten to base packages  
**Rationale**: Berry-specific optimization, Bun handles peers differently  
**Status**: ✅ Approved

### 2. Patch Protocol

**Decision**: Warn in Phase 1, full support in Phase 3  
**Rationale**: Complex feature, better to warn than fail  
**Status**: ✅ Approved

### 3. Version Support

**Decision**: Support Berry v6, v7, v8 only  
**Rationale**: v5 and below have different format  
**Status**: ✅ Approved

### 4. Exec Protocol

**Decision**: Skip with error  
**Rationale**: Very rare, Bun doesn't support  
**Status**: ✅ Approved

---

## 🔗 External Resources

### Official Docs

- Yarn Berry: https://yarnpkg.com/
- Protocols: https://yarnpkg.com/features/protocols
- Lexicon: https://yarnpkg.com/advanced/lexicon
- GitHub: https://github.com/yarnpkg/berry

### Bun Codebase References

- Yarn v1 migration: `src/install/yarn.zig`
- pnpm migration: `src/install/pnpm.zig`
- Migration orchestration: `src/install/migration.zig`
- Lockfile types: `src/install/lockfile.zig`
- YAML parser: `bun.interchange.yaml.YAML`

### Test References

- Yarn v1 tests: `test/cli/install/migration/yarn-lock-migration.test.ts`
- pnpm tests: `test/cli/install/migration/pnpm-migration.test.ts`

---

## ⚠️ Common Pitfalls to Avoid

1. **Forgetting protocol prefixes in dependencies**
   - All deps in Berry have protocols: `"dep": "npm:^1.0.0"`
   - Must strip protocol prefix to get version: `"^1.0.0"`

2. **Not unquoting YAML strings**
   - YAML may quote strings: `"npm:1.0.0"`
   - Must unquote: `npm:1.0.0`

3. **Mishandling URL encoding in patches**
   - `@` → `%40`, `:` → `%3A`
   - Must decode before parsing

4. **Treating virtual packages as regular packages**
   - Skip entries with `@virtual:` in key
   - Use base package instead

5. **Assuming workspace paths are always relative**
   - Root workspace uses `.` as path
   - Other workspaces use relative paths

6. **Not handling missing optional fields**
   - `checksum`, `dependencies`, `bin` may be absent
   - Must handle gracefully

7. **Confusing linkType values**
   - `soft` = workspace/link/portal (symlink-like)
   - `hard` = real package (downloaded)

8. **Forgetting to fetch metadata**
   - Berry doesn't store os/cpu
   - Must call `fetchNecessaryPackageMetadataAfterYarnOrPnpmMigration(manager, true)`

---

## 📈 Success Metrics

### Functional Requirements

- ✅ All packages from yarn.lock present in bun.lock
- ✅ All dependencies resolve correctly
- ✅ Workspace structure preserved
- ✅ Integrity hashes preserved
- ✅ Binary scripts preserved

### Quality Requirements

- ✅ 20+ test cases passing
- ✅ Real-world project tests (Babel, Jest, etc.)
- ✅ Edge cases handled gracefully
- ✅ Clear error messages

### Performance Requirements

- ✅ Migration <5s for typical projects
- ✅ Migration <30s for large monorepos
- ✅ Memory usage <500MB

---

## 🎓 Learning Resources

### For Understanding Berry Format

1. **Start here**: Section 2-3 of [Research Doc](YARN_BERRY_RESEARCH.md) (Entry Structure & Protocols)
2. **Examples**: Section 11 of [Research Doc](YARN_BERRY_RESEARCH.md) (Real-World Example)
3. **Quick lookup**: [Quick Reference](YARN_BERRY_QUICK_REF.md)

### For Implementation Patterns

1. **Architecture**: Section 12 of [Research Doc](YARN_BERRY_RESEARCH.md)
2. **Phase-by-phase**: [Implementation Plan](YARN_BERRY_IMPLEMENTATION_PLAN.md)
3. **Code snippets**: [Quick Reference](YARN_BERRY_QUICK_REF.md)

### For Comparison with v1

1. **Differences**: Section 13 of [Research Doc](YARN_BERRY_RESEARCH.md)
2. **v1 architecture**: [Yarn Rewrite Findings](YARN_REWRITE_FINDINGS.md)

---

## 📞 Questions?

### Where to find answers:

**"What is the format of X?"**
→ [Research Doc](YARN_BERRY_RESEARCH.md) sections 2-9

**"How do I implement Y?"**
→ [Implementation Plan](YARN_BERRY_IMPLEMENTATION_PLAN.md) or [Quick Ref](YARN_BERRY_QUICK_REF.md)

**"What's the difference between v1 and Berry?"**
→ [Research Doc](YARN_BERRY_RESEARCH.md) section 1-2, or this index's comparison table

**"What can I reuse from v1?"**
→ [Research Doc](YARN_BERRY_RESEARCH.md) section 13.1 or [Implementation Plan](YARN_BERRY_IMPLEMENTATION_PLAN.md) "Architecture Overview"

**"What are the gotchas?"**
→ [Quick Reference](YARN_BERRY_QUICK_REF.md) "Common Gotchas" section

**"What tests do I need?"**
→ [Research Doc](YARN_BERRY_RESEARCH.md) section 14 or [Implementation Plan](YARN_BERRY_IMPLEMENTATION_PLAN.md) "Test Plan Summary"

---

## 🚀 Ready to Start?

1. **Read** [Implementation Plan](YARN_BERRY_IMPLEMENTATION_PLAN.md) (1 hour)
2. **Skim** [Research Doc](YARN_BERRY_RESEARCH.md) (2 hours)
3. **Bookmark** [Quick Reference](YARN_BERRY_QUICK_REF.md) for during coding
4. **Start** Phase 1 implementation!

Good luck! 🎉

---

**Last Updated**: October 2025  
**Research Status**: ✅ Complete  
**Implementation Status**: ⏳ Not Started  
**Priority**: Medium-High  
**Estimated Effort**: 11-17 days
