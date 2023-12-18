Bun uses [a fork](https://github.com/oven-sh/WebKit) of WebKit with a small number of changes.

It's important to periodically update WebKit for many reasons:

- Security
- Performance
- Compatibility
- …and many more.

To upgrade, first find the commit in **Bun's WebKit fork** (not Bun!) between when we last upgraded and now.

```bash
$ cd src/bun.js/WebKit # In the WebKit directory! not bun
$ git checkout $COMMIT
```

This is the main command to run:

```bash
$ git merge upstream main
# If you get an error saying histories are unrelated, run this and try again:
$ git fetch --unshallow
```

Then, you will likely see some silly merge conflicts. Fix them and then run:

```bash
# You might have to run this multiple times.
$ rm -rf WebKitBuild

# Go to Bun's directory! Not WebKit.
cd ../../../../
make jsc-build-mac-compile
```

Make sure that JSC's CLI is able to load successfully. This verifies that the build is working.

You know this worked when it printed help options. If it complains about symbols, crashes, or anything else that looks wrong, something is wrong.

```bash
src/bun.js/WebKit/WebKitBuild/Release/bin/jsc --help
```

Then, clear out our bindings and regenerate the C++<>Zig headers:

```bash
make clean-bindings headers builtins
```

Now update Bun's bindings wherever there are compiler errors:

```bash
# It will take awhile if you don't pass -j here
make bindings -j10
```

This is the hard part. It might involve digging through WebKit's commit history to figure out what changed and why. Fortunately, WebKit contributors write great commit messages.
