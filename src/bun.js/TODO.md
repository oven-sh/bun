TODO: /Users/pfg/Dev/Node/temp/generated/cb8a9a78bd3ffe39426e2713d6992027/tmp

- [ ] there's a protect/unprotect bug even with safestrong :/
- [ ] fix safestrong
- [ ] then migrate to regular strong
- [x] need to switch CallbackWithArgs to be just a bound function

- allocation scope is not detecting leaks. it was broken. because no one calls the deinit fn. because it was transitioned to a shared pointer
- proposal: no hasDecl. unconditionally call deinit. alternatively, pass deinit as an arg.
