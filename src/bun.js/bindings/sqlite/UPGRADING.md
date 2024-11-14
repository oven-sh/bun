# Upgrading SQLite 3

1. Obtain the [amalgamation](https://www.sqlite.org/amalgamation.html) source code of SQLite from the [SQLite Download Page](https://www.sqlite.org/download.html). The file is a compressed .zip with `sqlite-amalgamation-[version].zip` name.

2. Unzip the downloaded file, and copy `sqlite3.c` and `sqlite3.h` to `sqlite3.c` and `sqlite3_local.h`, respecitvley, in this directory.

3. Use `git diff` to check any changes in `sqlite3_local.h`, and if so, update `sqlite3_error_codes.h` accordingly.
