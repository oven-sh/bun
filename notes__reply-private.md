6566b8120f does the first of the two. `copy_members` finds the one field of that name in the class of the bundle and writes the stated type there.

- `#level = Level.Low` with a numeric enum of another module is now `#level: Level;`. The test "a private field that the source map has no place for gets its type by its name" judges a caller by the sources and by the typed file.
- `#mode = Mode.Fast` with text values: the store is `"fast"` with no cast, so the check of the typed file refuses it (TS2322). The typed files are left out with the warning, as for a public field. #48466 has the cast for that store.
