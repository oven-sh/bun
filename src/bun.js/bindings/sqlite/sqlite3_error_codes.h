// This file must be updated whenever we update SQLite3
//
// When loading a system version of sqlite, some of these error codes will never
// be returned because the system version of SQLite may predate the error codes
// in this file.
//
// For code simplicity we always use the error codes from this file, even when
//
#pragma once

#ifndef SQLITE_OK

#define SQLITE_OK 0 /* Successful result */

#endif

#ifndef SQLITE_ERROR

#define SQLITE_ERROR 1 /* Generic error */

#endif

#ifndef SQLITE_INTERNAL

#define SQLITE_INTERNAL 2 /* Internal logic error in SQLite */

#endif

#ifndef SQLITE_PERM

#define SQLITE_PERM 3 /* Access permission denied */

#endif

#ifndef SQLITE_ABORT

#define SQLITE_ABORT 4 /* Callback routine requested an abort */

#endif

#ifndef SQLITE_BUSY

#define SQLITE_BUSY 5 /* The database file is locked */

#endif

#ifndef SQLITE_LOCKED

#define SQLITE_LOCKED 6 /* A table in the database is locked */

#endif

#ifndef SQLITE_NOMEM

#define SQLITE_NOMEM 7 /* A malloc() failed */

#endif

#ifndef SQLITE_READONLY

#define SQLITE_READONLY 8 /* Attempt to write a readonly database */

#endif

#ifndef SQLITE_INTERRUPT

#define SQLITE_INTERRUPT 9 /* Operation terminated by sqlite3_interrupt()*/

#endif

#ifndef SQLITE_IOERR

#define SQLITE_IOERR 10 /* Some kind of disk I/O error occurred */

#endif

#ifndef SQLITE_CORRUPT

#define SQLITE_CORRUPT 11 /* The database disk image is malformed */

#endif

#ifndef SQLITE_NOTFOUND

#define SQLITE_NOTFOUND 12 /* Unknown opcode in sqlite3_file_control() */

#endif

#ifndef SQLITE_FULL

#define SQLITE_FULL 13 /* Insertion failed because database is full */

#endif

#ifndef SQLITE_CANTOPEN

#define SQLITE_CANTOPEN 14 /* Unable to open the database file */

#endif

#ifndef SQLITE_PROTOCOL

#define SQLITE_PROTOCOL 15 /* Database lock protocol error */

#endif

#ifndef SQLITE_EMPTY

#define SQLITE_EMPTY 16 /* Internal use only */

#endif

#ifndef SQLITE_SCHEMA

#define SQLITE_SCHEMA 17 /* The database schema changed */

#endif

#ifndef SQLITE_TOOBIG

#define SQLITE_TOOBIG 18 /* String or BLOB exceeds size limit */

#endif

#ifndef SQLITE_CONSTRAINT

#define SQLITE_CONSTRAINT 19 /* Abort due to constraint violation */

#endif

#ifndef SQLITE_MISMATCH

#define SQLITE_MISMATCH 20 /* Data type mismatch */

#endif

#ifndef SQLITE_MISUSE

#define SQLITE_MISUSE 21 /* Library used incorrectly */

#endif

#ifndef SQLITE_NOLFS

#define SQLITE_NOLFS 22 /* Uses OS features not supported on host */

#endif

#ifndef SQLITE_AUTH

#define SQLITE_AUTH 23 /* Authorization denied */

#endif

#ifndef SQLITE_FORMAT

#define SQLITE_FORMAT 24 /* Not used */

#endif

#ifndef SQLITE_RANGE

#define SQLITE_RANGE 25 /* 2nd parameter to sqlite3_bind out of range */

#endif

#ifndef SQLITE_NOTADB

#define SQLITE_NOTADB 26 /* File opened that is not a database file */

#endif

#ifndef SQLITE_NOTICE

#define SQLITE_NOTICE 27 /* Notifications from sqlite3_log() */

#endif

#ifndef SQLITE_WARNING

#define SQLITE_WARNING 28 /* Warnings from sqlite3_log() */

#endif

#ifndef SQLITE_ROW

#define SQLITE_ROW 100 /* sqlite3_step() has another row ready */

#endif

#ifndef SQLITE_DONE

#define SQLITE_DONE 101 /* sqlite3_step() has finished executing */

#endif

#ifndef SQLITE_ERROR_MISSING_COLLSEQ

#define SQLITE_ERROR_MISSING_COLLSEQ (SQLITE_ERROR | (1 << 8))

#endif

#ifndef SQLITE_ERROR_RETRY

#define SQLITE_ERROR_RETRY (SQLITE_ERROR | (2 << 8))

#endif

#ifndef SQLITE_ERROR_SNAPSHOT

#define SQLITE_ERROR_SNAPSHOT (SQLITE_ERROR | (3 << 8))

#endif

#ifndef SQLITE_IOERR_READ

#define SQLITE_IOERR_READ (SQLITE_IOERR | (1 << 8))

#endif

#ifndef SQLITE_IOERR_SHORT_READ

#define SQLITE_IOERR_SHORT_READ (SQLITE_IOERR | (2 << 8))

#endif

#ifndef SQLITE_IOERR_WRITE

#define SQLITE_IOERR_WRITE (SQLITE_IOERR | (3 << 8))

#endif

#ifndef SQLITE_IOERR_FSYNC

#define SQLITE_IOERR_FSYNC (SQLITE_IOERR | (4 << 8))

#endif

#ifndef SQLITE_IOERR_DIR_FSYNC

#define SQLITE_IOERR_DIR_FSYNC (SQLITE_IOERR | (5 << 8))

#endif

#ifndef SQLITE_IOERR_TRUNCATE

#define SQLITE_IOERR_TRUNCATE (SQLITE_IOERR | (6 << 8))

#endif

#ifndef SQLITE_IOERR_FSTAT

#define SQLITE_IOERR_FSTAT (SQLITE_IOERR | (7 << 8))

#endif

#ifndef SQLITE_IOERR_UNLOCK

#define SQLITE_IOERR_UNLOCK (SQLITE_IOERR | (8 << 8))

#endif

#ifndef SQLITE_IOERR_RDLOCK

#define SQLITE_IOERR_RDLOCK (SQLITE_IOERR | (9 << 8))

#endif

#ifndef SQLITE_IOERR_DELETE

#define SQLITE_IOERR_DELETE (SQLITE_IOERR | (10 << 8))

#endif

#ifndef SQLITE_IOERR_BLOCKED

#define SQLITE_IOERR_BLOCKED (SQLITE_IOERR | (11 << 8))

#endif

#ifndef SQLITE_IOERR_NOMEM

#define SQLITE_IOERR_NOMEM (SQLITE_IOERR | (12 << 8))

#endif

#ifndef SQLITE_IOERR_ACCESS

#define SQLITE_IOERR_ACCESS (SQLITE_IOERR | (13 << 8))

#endif

#ifndef SQLITE_IOERR_CHECKRESERVEDLOCK

#define SQLITE_IOERR_CHECKRESERVEDLOCK (SQLITE_IOERR | (14 << 8))

#endif

#ifndef SQLITE_IOERR_LOCK

#define SQLITE_IOERR_LOCK (SQLITE_IOERR | (15 << 8))

#endif

#ifndef SQLITE_IOERR_CLOSE

#define SQLITE_IOERR_CLOSE (SQLITE_IOERR | (16 << 8))

#endif

#ifndef SQLITE_IOERR_DIR_CLOSE

#define SQLITE_IOERR_DIR_CLOSE (SQLITE_IOERR | (17 << 8))

#endif

#ifndef SQLITE_IOERR_SHMOPEN

#define SQLITE_IOERR_SHMOPEN (SQLITE_IOERR | (18 << 8))

#endif

#ifndef SQLITE_IOERR_SHMSIZE

#define SQLITE_IOERR_SHMSIZE (SQLITE_IOERR | (19 << 8))

#endif

#ifndef SQLITE_IOERR_SHMLOCK

#define SQLITE_IOERR_SHMLOCK (SQLITE_IOERR | (20 << 8))

#endif

#ifndef SQLITE_IOERR_SHMMAP

#define SQLITE_IOERR_SHMMAP (SQLITE_IOERR | (21 << 8))

#endif

#ifndef SQLITE_IOERR_SEEK

#define SQLITE_IOERR_SEEK (SQLITE_IOERR | (22 << 8))

#endif

#ifndef SQLITE_IOERR_DELETE_NOENT

#define SQLITE_IOERR_DELETE_NOENT (SQLITE_IOERR | (23 << 8))

#endif

#ifndef SQLITE_IOERR_MMAP

#define SQLITE_IOERR_MMAP (SQLITE_IOERR | (24 << 8))

#endif

#ifndef SQLITE_IOERR_GETTEMPPATH

#define SQLITE_IOERR_GETTEMPPATH (SQLITE_IOERR | (25 << 8))

#endif

#ifndef SQLITE_IOERR_CONVPATH

#define SQLITE_IOERR_CONVPATH (SQLITE_IOERR | (26 << 8))

#endif

#ifndef SQLITE_IOERR_VNODE

#define SQLITE_IOERR_VNODE (SQLITE_IOERR | (27 << 8))

#endif

#ifndef SQLITE_IOERR_AUTH

#define SQLITE_IOERR_AUTH (SQLITE_IOERR | (28 << 8))

#endif

#ifndef SQLITE_IOERR_BEGIN_ATOMIC

#define SQLITE_IOERR_BEGIN_ATOMIC (SQLITE_IOERR | (29 << 8))

#endif

#ifndef SQLITE_IOERR_COMMIT_ATOMIC

#define SQLITE_IOERR_COMMIT_ATOMIC (SQLITE_IOERR | (30 << 8))

#endif

#ifndef SQLITE_IOERR_ROLLBACK_ATOMIC

#define SQLITE_IOERR_ROLLBACK_ATOMIC (SQLITE_IOERR | (31 << 8))

#endif

#ifndef SQLITE_IOERR_DATA

#define SQLITE_IOERR_DATA (SQLITE_IOERR | (32 << 8))

#endif

#ifndef SQLITE_IOERR_CORRUPTFS

#define SQLITE_IOERR_CORRUPTFS (SQLITE_IOERR | (33 << 8))

#endif

#ifndef SQLITE_IOERR_IN_PAGE

#define SQLITE_IOERR_IN_PAGE (SQLITE_IOERR | (34 << 8))

#endif

#ifndef SQLITE_LOCKED_SHAREDCACHE

#define SQLITE_LOCKED_SHAREDCACHE (SQLITE_LOCKED | (1 << 8))

#endif

#ifndef SQLITE_LOCKED_VTAB

#define SQLITE_LOCKED_VTAB (SQLITE_LOCKED | (2 << 8))

#endif

#ifndef SQLITE_BUSY_RECOVERY

#define SQLITE_BUSY_RECOVERY (SQLITE_BUSY | (1 << 8))

#endif

#ifndef SQLITE_BUSY_SNAPSHOT

#define SQLITE_BUSY_SNAPSHOT (SQLITE_BUSY | (2 << 8))

#endif

#ifndef SQLITE_BUSY_TIMEOUT

#define SQLITE_BUSY_TIMEOUT (SQLITE_BUSY | (3 << 8))

#endif

#ifndef SQLITE_CANTOPEN_NOTEMPDIR

#define SQLITE_CANTOPEN_NOTEMPDIR (SQLITE_CANTOPEN | (1 << 8))

#endif

#ifndef SQLITE_CANTOPEN_ISDIR

#define SQLITE_CANTOPEN_ISDIR (SQLITE_CANTOPEN | (2 << 8))

#endif

#ifndef SQLITE_CANTOPEN_FULLPATH

#define SQLITE_CANTOPEN_FULLPATH (SQLITE_CANTOPEN | (3 << 8))

#endif

#ifndef SQLITE_CANTOPEN_CONVPATH

#define SQLITE_CANTOPEN_CONVPATH (SQLITE_CANTOPEN | (4 << 8))

#endif

#ifndef SQLITE_CANTOPEN_DIRTYWAL

#define SQLITE_CANTOPEN_DIRTYWAL (SQLITE_CANTOPEN | (5 << 8)) /* Not Used */

#endif

#ifndef SQLITE_CANTOPEN_SYMLINK

#define SQLITE_CANTOPEN_SYMLINK (SQLITE_CANTOPEN | (6 << 8))

#endif

#ifndef SQLITE_CORRUPT_VTAB

#define SQLITE_CORRUPT_VTAB (SQLITE_CORRUPT | (1 << 8))

#endif

#ifndef SQLITE_CORRUPT_SEQUENCE

#define SQLITE_CORRUPT_SEQUENCE (SQLITE_CORRUPT | (2 << 8))

#endif

#ifndef SQLITE_CORRUPT_INDEX

#define SQLITE_CORRUPT_INDEX (SQLITE_CORRUPT | (3 << 8))

#endif

#ifndef SQLITE_READONLY_RECOVERY

#define SQLITE_READONLY_RECOVERY (SQLITE_READONLY | (1 << 8))

#endif

#ifndef SQLITE_READONLY_CANTLOCK

#define SQLITE_READONLY_CANTLOCK (SQLITE_READONLY | (2 << 8))

#endif

#ifndef SQLITE_READONLY_ROLLBACK

#define SQLITE_READONLY_ROLLBACK (SQLITE_READONLY | (3 << 8))

#endif

#ifndef SQLITE_READONLY_DBMOVED

#define SQLITE_READONLY_DBMOVED (SQLITE_READONLY | (4 << 8))

#endif

#ifndef SQLITE_READONLY_CANTINIT

#define SQLITE_READONLY_CANTINIT (SQLITE_READONLY | (5 << 8))

#endif

#ifndef SQLITE_READONLY_DIRECTORY

#define SQLITE_READONLY_DIRECTORY (SQLITE_READONLY | (6 << 8))

#endif

#ifndef SQLITE_ABORT_ROLLBACK

#define SQLITE_ABORT_ROLLBACK (SQLITE_ABORT | (2 << 8))

#endif

#ifndef SQLITE_CONSTRAINT_CHECK

#define SQLITE_CONSTRAINT_CHECK (SQLITE_CONSTRAINT | (1 << 8))

#endif

#ifndef SQLITE_CONSTRAINT_COMMITHOOK

#define SQLITE_CONSTRAINT_COMMITHOOK (SQLITE_CONSTRAINT | (2 << 8))

#endif

#ifndef SQLITE_CONSTRAINT_FOREIGNKEY

#define SQLITE_CONSTRAINT_FOREIGNKEY (SQLITE_CONSTRAINT | (3 << 8))

#endif

#ifndef SQLITE_CONSTRAINT_FUNCTION

#define SQLITE_CONSTRAINT_FUNCTION (SQLITE_CONSTRAINT | (4 << 8))

#endif

#ifndef SQLITE_CONSTRAINT_NOTNULL

#define SQLITE_CONSTRAINT_NOTNULL (SQLITE_CONSTRAINT | (5 << 8))

#endif

#ifndef SQLITE_CONSTRAINT_PRIMARYKEY

#define SQLITE_CONSTRAINT_PRIMARYKEY (SQLITE_CONSTRAINT | (6 << 8))

#endif

#ifndef SQLITE_CONSTRAINT_TRIGGER

#define SQLITE_CONSTRAINT_TRIGGER (SQLITE_CONSTRAINT | (7 << 8))

#endif

#ifndef SQLITE_CONSTRAINT_UNIQUE

#define SQLITE_CONSTRAINT_UNIQUE (SQLITE_CONSTRAINT | (8 << 8))

#endif

#ifndef SQLITE_CONSTRAINT_VTAB

#define SQLITE_CONSTRAINT_VTAB (SQLITE_CONSTRAINT | (9 << 8))

#endif

#ifndef SQLITE_CONSTRAINT_ROWID

#define SQLITE_CONSTRAINT_ROWID (SQLITE_CONSTRAINT | (10 << 8))

#endif

#ifndef SQLITE_CONSTRAINT_PINNED

#define SQLITE_CONSTRAINT_PINNED (SQLITE_CONSTRAINT | (11 << 8))

#endif

#ifndef SQLITE_CONSTRAINT_DATATYPE

#define SQLITE_CONSTRAINT_DATATYPE (SQLITE_CONSTRAINT | (12 << 8))

#endif

#ifndef SQLITE_NOTICE_RECOVER_WAL

#define SQLITE_NOTICE_RECOVER_WAL (SQLITE_NOTICE | (1 << 8))

#endif

#ifndef SQLITE_NOTICE_RECOVER_ROLLBACK

#define SQLITE_NOTICE_RECOVER_ROLLBACK (SQLITE_NOTICE | (2 << 8))

#endif

#ifndef SQLITE_NOTICE_RBU

#define SQLITE_NOTICE_RBU (SQLITE_NOTICE | (3 << 8))

#endif

#ifndef SQLITE_WARNING_AUTOINDEX

#define SQLITE_WARNING_AUTOINDEX (SQLITE_WARNING | (1 << 8))

#endif

#ifndef SQLITE_AUTH_USER

#define SQLITE_AUTH_USER (SQLITE_AUTH | (1 << 8))

#endif

#ifndef SQLITE_OK_LOAD_PERMANENTLY

#define SQLITE_OK_LOAD_PERMANENTLY (SQLITE_OK | (1 << 8))

#endif

#ifndef SQLITE_OK_SYMLINK

#define SQLITE_OK_SYMLINK (SQLITE_OK | (2 << 8))

#endif

#define FOR_EACH_SQLITE_ERROR(MACRO)      \
    MACRO(SQLITE_INTERNAL)                \
    MACRO(SQLITE_PERM)                    \
    MACRO(SQLITE_ABORT)                   \
    MACRO(SQLITE_BUSY)                    \
    MACRO(SQLITE_LOCKED)                  \
    MACRO(SQLITE_NOMEM)                   \
    MACRO(SQLITE_READONLY)                \
    MACRO(SQLITE_INTERRUPT)               \
    MACRO(SQLITE_IOERR)                   \
    MACRO(SQLITE_CORRUPT)                 \
    MACRO(SQLITE_NOTFOUND)                \
    MACRO(SQLITE_FULL)                    \
    MACRO(SQLITE_CANTOPEN)                \
    MACRO(SQLITE_PROTOCOL)                \
    MACRO(SQLITE_EMPTY)                   \
    MACRO(SQLITE_SCHEMA)                  \
    MACRO(SQLITE_TOOBIG)                  \
    MACRO(SQLITE_CONSTRAINT)              \
    MACRO(SQLITE_MISMATCH)                \
    MACRO(SQLITE_MISUSE)                  \
    MACRO(SQLITE_NOLFS)                   \
    MACRO(SQLITE_AUTH)                    \
    MACRO(SQLITE_FORMAT)                  \
    MACRO(SQLITE_RANGE)                   \
    MACRO(SQLITE_NOTADB)                  \
    MACRO(SQLITE_NOTICE)                  \
    MACRO(SQLITE_WARNING)                 \
    MACRO(SQLITE_ERROR_MISSING_COLLSEQ)   \
    MACRO(SQLITE_ERROR_RETRY)             \
    MACRO(SQLITE_ERROR_SNAPSHOT)          \
    MACRO(SQLITE_IOERR_READ)              \
    MACRO(SQLITE_IOERR_SHORT_READ)        \
    MACRO(SQLITE_IOERR_WRITE)             \
    MACRO(SQLITE_IOERR_FSYNC)             \
    MACRO(SQLITE_IOERR_DIR_FSYNC)         \
    MACRO(SQLITE_IOERR_TRUNCATE)          \
    MACRO(SQLITE_IOERR_FSTAT)             \
    MACRO(SQLITE_IOERR_UNLOCK)            \
    MACRO(SQLITE_IOERR_RDLOCK)            \
    MACRO(SQLITE_IOERR_DELETE)            \
    MACRO(SQLITE_IOERR_BLOCKED)           \
    MACRO(SQLITE_IOERR_NOMEM)             \
    MACRO(SQLITE_IOERR_ACCESS)            \
    MACRO(SQLITE_IOERR_CHECKRESERVEDLOCK) \
    MACRO(SQLITE_IOERR_LOCK)              \
    MACRO(SQLITE_IOERR_CLOSE)             \
    MACRO(SQLITE_IOERR_DIR_CLOSE)         \
    MACRO(SQLITE_IOERR_SHMOPEN)           \
    MACRO(SQLITE_IOERR_SHMSIZE)           \
    MACRO(SQLITE_IOERR_SHMLOCK)           \
    MACRO(SQLITE_IOERR_SHMMAP)            \
    MACRO(SQLITE_IOERR_SEEK)              \
    MACRO(SQLITE_IOERR_DELETE_NOENT)      \
    MACRO(SQLITE_IOERR_MMAP)              \
    MACRO(SQLITE_IOERR_GETTEMPPATH)       \
    MACRO(SQLITE_IOERR_CONVPATH)          \
    MACRO(SQLITE_IOERR_VNODE)             \
    MACRO(SQLITE_IOERR_AUTH)              \
    MACRO(SQLITE_IOERR_BEGIN_ATOMIC)      \
    MACRO(SQLITE_IOERR_COMMIT_ATOMIC)     \
    MACRO(SQLITE_IOERR_ROLLBACK_ATOMIC)   \
    MACRO(SQLITE_IOERR_DATA)              \
    MACRO(SQLITE_IOERR_CORRUPTFS)         \
    MACRO(SQLITE_IOERR_IN_PAGE)           \
    MACRO(SQLITE_LOCKED_SHAREDCACHE)      \
    MACRO(SQLITE_LOCKED_VTAB)             \
    MACRO(SQLITE_BUSY_RECOVERY)           \
    MACRO(SQLITE_BUSY_SNAPSHOT)           \
    MACRO(SQLITE_BUSY_TIMEOUT)            \
    MACRO(SQLITE_CANTOPEN_NOTEMPDIR)      \
    MACRO(SQLITE_CANTOPEN_ISDIR)          \
    MACRO(SQLITE_CANTOPEN_FULLPATH)       \
    MACRO(SQLITE_CANTOPEN_CONVPATH)       \
    MACRO(SQLITE_CANTOPEN_DIRTYWAL)       \
    MACRO(SQLITE_CANTOPEN_SYMLINK)        \
    MACRO(SQLITE_CORRUPT_VTAB)            \
    MACRO(SQLITE_CORRUPT_SEQUENCE)        \
    MACRO(SQLITE_CORRUPT_INDEX)           \
    MACRO(SQLITE_READONLY_RECOVERY)       \
    MACRO(SQLITE_READONLY_CANTLOCK)       \
    MACRO(SQLITE_READONLY_ROLLBACK)       \
    MACRO(SQLITE_READONLY_DBMOVED)        \
    MACRO(SQLITE_READONLY_CANTINIT)       \
    MACRO(SQLITE_READONLY_DIRECTORY)      \
    MACRO(SQLITE_ABORT_ROLLBACK)          \
    MACRO(SQLITE_CONSTRAINT_CHECK)        \
    MACRO(SQLITE_CONSTRAINT_COMMITHOOK)   \
    MACRO(SQLITE_CONSTRAINT_FOREIGNKEY)   \
    MACRO(SQLITE_CONSTRAINT_FUNCTION)     \
    MACRO(SQLITE_CONSTRAINT_NOTNULL)      \
    MACRO(SQLITE_CONSTRAINT_PRIMARYKEY)   \
    MACRO(SQLITE_CONSTRAINT_TRIGGER)      \
    MACRO(SQLITE_CONSTRAINT_UNIQUE)       \
    MACRO(SQLITE_CONSTRAINT_VTAB)         \
    MACRO(SQLITE_CONSTRAINT_ROWID)        \
    MACRO(SQLITE_CONSTRAINT_PINNED)       \
    MACRO(SQLITE_CONSTRAINT_DATATYPE)     \
    MACRO(SQLITE_NOTICE_RECOVER_WAL)      \
    MACRO(SQLITE_NOTICE_RECOVER_ROLLBACK) \
    MACRO(SQLITE_NOTICE_RBU)              \
    MACRO(SQLITE_WARNING_AUTOINDEX)       \
    MACRO(SQLITE_AUTH_USER)               \
    MACRO(SQLITE_OK_LOAD_PERMANENTLY)     \
    MACRO(SQLITE_OK_SYMLINK)