Upgrade Bun's Webkit fork to the latest upstream version of Webkit.

To do that:

- cd vendor/WebKit
- git fetch upstream
- git merge upstream main
- Fix the merge conflicts
- bun build.ts debug
- While it compiles, in another task review the JSC commits between the last version of Webkit and the new version. Write up a summary of the webkit changes in a file called "webkit-changes.md"
- bun run build:local (build a build of Bun with the new Webkit, make sure it compiles)
- After making sure it compiles, run some code to make sure things work. something like ./build/debug-local/bun-debug --print '42' should be all you need
- cd vendor/WebKit
- git commit -am "Upgrade Webkit to the latest version"
- git push
- get the commit SHA in the vendor/WebKit directory of your new commit
- cd ../../ (back to bun)
- Update WEBKIT_VERSION in cmake/tools/SetupWebKit.cmake to the commit SHA of your new commit
- git checkout -b bun/webkit-upgrade-<commit-sha>
- commit + push (without adding the webkit-changes.md file)
- create PR titled "Upgrade Webkit to the <commit-sha>", paste your webkit-changes.md into the PR description
- delete the webkit-changes.md file

Things to check for a successful upgrade:
- Did JSType in vendor/WebKit/Source/JavaScriptCore have any recent changes? Does the enum values align with whats present in src/bun.js/bindings/JSType.zig?
- Were there any changes to the webcore code generator? If there are C++ compilation errors, check for differences in some of the generated code in like vendor/WebKit/source/WebCore/bindings/scripts/test/JS/
