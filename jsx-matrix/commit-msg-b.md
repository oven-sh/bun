jsx: the project's tsconfig.json does not decide an option that bunfig.toml, a flag or Bun.build states

An option of jsx::Sources that a source states itself is read as if the
tsconfig.json of the project, and each file that it extends, did not state
it (Stated::lay_tsconfig_over). The tsconfig.json of the project is the
nearest one to the working directory.

A merged TSConfigJSON keeps what each file of its extends chain states, and
BundleOptions::lay_tsconfig lays the chain file by file. So the rule also
holds where a tsconfig.json in a directory below takes the option from a
file of the project. What that tsconfig.json states itself, a tsconfig.json
of a dependency and the file of --tsconfig-override decide as before. A
file of the project is known by its name and the real path of the directory
that holds it, so one that is read again after its directory changed, or
that is reached through a link to a directory, is still the project's. The
ahead-of-time compiler reads the files of the project in the same way
(JsxStated).

A default of a source is not a statement: a bunfig.toml without JSX keys,
the production default of the --jsx-* flags and the mode of a server do not
hide what a tsconfig.json states. A statement stays in force when a later
default says the same value: `jsx = "react-jsx"` in bunfig.toml beside a
flag with a value states the production runtime. NODE_ENV picks the
development or the production runtime as before.
