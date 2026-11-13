fd33a8f1f5 writes the annotation of the member at that field, and the stated text only where the member has no annotation.

`#level: Level = Level.Low` with `Level` of another module is now `#level: Level;`, and its store is `this.#level = 0 as Level.Low`. The test "a field whose value is a member of an enum of another module has its type, and the value its cast" has this field as `#kept`.
