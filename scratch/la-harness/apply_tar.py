#!/usr/bin/env python3
# Applies the tar-reader part of the non-blocking patch to a pristine
# archive_read_support_format_tar.c (argv[1], edited in place).
import sys
p = sys.argv[1]
s = open(p).read()

def rep(old, new, count=1):
    global s
    assert s.count(old) == count, (s.count(old), old[:80])
    s = s.replace(old, new)

# 1. struct tar: replay state
rep('''	int			 default_inode;
	int			 default_dev;
};
''', '''	int			 default_inode;
	int			 default_dev;

	/*
	 * BUN PATCH: header replay state for non-blocking sources.
	 * See tar_read_ahead().
	 */
	int			 nonblocking;
	int64_t			 header_offset;
	int64_t			 header_avail;
	size_t			 header_need;
	int			 header_deferring;
	int			 header_would_block;
	int			 header_replay;
	int			 header_saved_inode;
	int			 header_saved_dev;
	int64_t			 header_saved_sparse_offset;
	int64_t			 header_saved_sparse_numbytes;
};
''')

# 2. wrappers, redirect, retryable data consume
rep('''int
archive_read_support_format_gnutar(struct archive *a)
{''', r'''/*
 * BUN PATCH: header replay for non-blocking sources.
 *
 * Upstream has no way for a client read callback to say "no bytes
 * yet" (https://github.com/libarchive/libarchive/issues/1268). With
 * this patch a client that is fed incrementally (tarball bytes that
 * arrive from the network during `bun install`) answers ARCHIVE_RETRY
 * for that. Such a client sets the "nonblocking" option. Without the
 * option nothing below runs, and a header is read exactly as
 * upstream reads it.
 *
 * The header of one entry is a sequence of blocks: pax 'x'/'g' and
 * GNU 'L'/'K' extensions, the header itself, GNU sparse extension
 * blocks, a PAX 1.0 sparse map, an AppleDouble blob. The source can
 * run dry inside any of them.
 *
 * While a header is read with the option set, every
 * __archive_read_ahead() and __archive_read_consume() in this file
 * goes through the two functions below. A consume only moves
 * `header_offset`, so the whole sequence stays in the filter's
 * buffer. When the source runs dry,
 * archive_read_format_tar_read_header() forgets what it parsed and
 * returns ARCHIVE_RETRY, and the next call parses the sequence again
 * from its first byte. A complete parse consumes the sequence at
 * once. The readers are unchanged: a dry read looks like a short read
 * to them, and they unwind through their error paths.
 *
 * A sequence longer than TAR_HEADER_REPLAY_LIMIT is consumed as it
 * is read from that point on, which bounds the buffer. A dry read
 * past that point is a truncation error.
 */
#define TAR_HEADER_REPLAY_LIMIT ((int64_t)32 * 1024 * 1024)

static void
tar_header_commit(struct archive_read *a, struct tar *tar)
{
	/* Every byte below header_offset is buffered, so this cannot
	 * reach the client reader. */
	if (tar->header_offset > 0)
		__archive_read_consume(a, tar->header_offset);
	tar->header_offset = 0;
	tar->header_deferring = 0;
}

/*
 * Consume what this header has used so far and keep deferring. The
 * caller knows that a replay can start from here.
 */
static void
tar_header_checkpoint(struct archive_read *a, struct tar *tar)
{
	if (tar->header_deferring && tar->header_offset > 0) {
		__archive_read_consume(a, tar->header_offset);
		tar->header_avail -= tar->header_offset;
		tar->header_offset = 0;
	}
}

static const void *
tar_read_ahead(struct archive_read *a, size_t min, ssize_t *avail)
{
	struct tar *tar = a->format->data;
	const char *p;
	ssize_t got;

	if (tar->header_would_block) {
		if (avail != NULL)
			*avail = ARCHIVE_RETRY;
		return (NULL);
	}
	if (min > (size_t)(TAR_HEADER_REPLAY_LIMIT - tar->header_offset)) {
		tar_header_commit(a, tar);
		return (__archive_read_ahead(a, min, avail));
	}
	p = __archive_read_ahead(a, (size_t)tar->header_offset + min, &got);
	if (p == NULL) {
		if (got == ARCHIVE_RETRY) {
			tar->header_would_block = 1;
			tar->header_need = (size_t)tar->header_offset + min;
		} else if (got >= 0) {
			/* End of input: report what is left after the
			 * bytes this header has already used. */
			got -= (ssize_t)tar->header_offset;
		}
		if (avail != NULL)
			*avail = got;
		return (NULL);
	}
	if (got > tar->header_avail)
		tar->header_avail = got;
	if (avail != NULL)
		*avail = got - (ssize_t)tar->header_offset;
	return (p + tar->header_offset);
}

static int64_t
tar_read_consume(struct archive_read *a, int64_t request)
{
	struct tar *tar = a->format->data;
	ssize_t got;

	if (request < 0 || tar->header_would_block)
		return (ARCHIVE_FATAL);
	if (request > TAR_HEADER_REPLAY_LIMIT - tar->header_offset) {
		tar_header_commit(a, tar);
		return (__archive_read_consume(a, request));
	}
	if (tar->header_offset + request > tar->header_avail) {
		/* A skip over bytes that no reader looked at. Make
		 * sure they are buffered. */
		if (__archive_read_ahead(a,
		    (size_t)(tar->header_offset + request), &got) == NULL) {
			if (got == ARCHIVE_RETRY) {
				tar->header_would_block = 1;
				tar->header_need =
				    (size_t)(tar->header_offset + request);
				return (ARCHIVE_FATAL);
			}
			/* End of input or a read error: the real
			 * consume reports it. */
			tar_header_commit(a, tar);
			return (__archive_read_consume(a, request));
		}
		tar->header_avail = got;
	}
	tar->header_offset += request;
	return (request);
}

/*
 * BUN PATCH: consume up to `request` bytes in a way that is safe to
 * resume from a non-blocking source. Each iteration uses
 * __archive_read_ahead(1) to discover how many bytes are currently
 * buffered and then __archive_read_consume()s exactly that much, so
 * the consume never has to invoke the client reader itself. On
 * ARCHIVE_RETRY the remaining amount is written back into
 * `tar->entry_bytes_remaining` / `tar->entry_padding` so the next
 * call (via archive_read_next_header -> read_data_skip, or another
 * read_data_block) continues from the right offset.
 */
static int
tar_consume_retryable(struct archive_read *a, struct tar *tar,
    int64_t request)
{
	while (request > 0) {
		ssize_t avail = 0;
		const void *p = __archive_read_ahead(a, 1, &avail);
		if (p == NULL) {
			if (avail == ARCHIVE_RETRY) {
				/* Persist what is still owed so the
				 * next resume asks for the remainder
				 * rather than the original total. */
				if (request >= tar->entry_padding) {
					tar->entry_bytes_remaining =
					    request - tar->entry_padding;
				} else {
					tar->entry_bytes_remaining = 0;
					tar->entry_padding = request;
				}
				return (ARCHIVE_RETRY);
			}
			archive_set_error(&a->archive,
			    ARCHIVE_ERRNO_MISC,
			    "Truncated tar archive"
			    " detected while skipping data");
			return (ARCHIVE_FATAL);
		}
		if (avail > request)
			avail = (ssize_t)request;
		if (__archive_read_consume(a, avail) != avail)
			return (ARCHIVE_FATAL);
		request -= avail;
	}
	return (ARCHIVE_OK);
}

#define __archive_read_ahead(a, min, avail) \
	(((struct tar *)(a)->format->data)->header_deferring \
	    ? tar_read_ahead((a), (min), (avail)) \
	    : (__archive_read_ahead)((a), (min), (avail)))
#define __archive_read_consume(a, request) \
	(((struct tar *)(a)->format->data)->header_deferring \
	    ? tar_read_consume((a), (request)) \
	    : (__archive_read_consume)((a), (request)))

int
archive_read_support_format_gnutar(struct archive *a)
{''')

# 2b. the data phase reads the filter directly
rep('''static int
archive_read_format_tar_read_data(struct archive_read *a,
    const void **buff, size_t *size, int64_t *offset)
{''', r'''/* BUN PATCH: no header is in progress in the two functions below. */
#undef __archive_read_ahead
#undef __archive_read_consume

static int
archive_read_format_tar_read_data(struct archive_read *a,
    const void **buff, size_t *size, int64_t *offset)
{''')
rep('''	/* Free the sparse list. */
	gnu_clear_sparse_list(tar);

	return (ARCHIVE_OK);
}
''', r'''	/* Free the sparse list. */
	gnu_clear_sparse_list(tar);

	return (ARCHIVE_OK);
}

#define __archive_read_ahead(a, min, avail) \
	(((struct tar *)(a)->format->data)->header_deferring \
	    ? tar_read_ahead((a), (min), (avail)) \
	    : (__archive_read_ahead)((a), (min), (avail)))
#define __archive_read_consume(a, request) \
	(((struct tar *)(a)->format->data)->header_deferring \
	    ? tar_read_consume((a), (request)) \
	    : (__archive_read_consume)((a), (request)))
''')

# 2c. the option
rep('''	} else if (strcmp(key, "read_concatenated_archives") == 0) {
		tar->read_concatenated_archives = (val != NULL && val[0] != 0);
		return (ARCHIVE_OK);
	}
''', '''	} else if (strcmp(key, "read_concatenated_archives") == 0) {
		tar->read_concatenated_archives = (val != NULL && val[0] != 0);
		return (ARCHIVE_OK);
	} else if (strcmp(key, "nonblocking") == 0) {
		/* BUN PATCH: see tar_read_ahead(). */
		tar->nonblocking = (val != NULL && val[0] != 0);
		return (ARCHIVE_OK);
	}
''')

# 3. read_header: begin / rollback / commit
rep('''	size_t l;
	int64_t unconsumed = 0;

	/* Assign default device/inode values. */''', '''	size_t l;
	int64_t unconsumed = 0;
	ssize_t avail;

	/*
	 * BUN PATCH: see tar_read_ahead(). After a dry read, start
	 * again from the state this entry started with. The four
	 * saved fields are the ones a header reads before it writes
	 * them.
	 */
	if (tar->nonblocking) {
		if (tar->header_replay) {
			tar->default_inode = tar->header_saved_inode;
			tar->default_dev = tar->header_saved_dev;
			tar->sparse_offset = tar->header_saved_sparse_offset;
			tar->sparse_numbytes =
			    tar->header_saved_sparse_numbytes;
			/* Parse again only when the bytes that were
			 * missing are there. */
			if (__archive_read_ahead(a, tar->header_need,
			    &avail) == NULL && avail == ARCHIVE_RETRY)
				return (ARCHIVE_RETRY);
			tar->header_replay = 0;
		} else {
			tar->header_saved_inode = tar->default_inode;
			tar->header_saved_dev = tar->default_dev;
			tar->header_saved_sparse_offset = tar->sparse_offset;
			tar->header_saved_sparse_numbytes =
			    tar->sparse_numbytes;
		}
		tar->header_offset = 0;
		tar->header_avail = 0;
		tar->header_deferring = 1;
	}

	/* Assign default device/inode values. */''')

rep('''	r = tar_read_header(a, tar, entry, &unconsumed);

	tar_flush_unconsumed(a, &unconsumed);
''', '''	r = tar_read_header(a, tar, entry, &unconsumed);

	tar_flush_unconsumed(a, &unconsumed);

	/*
	 * BUN PATCH: the source ran dry somewhere in this header.
	 * Nothing was consumed. Drop what was parsed, and tell
	 * archive_read_next_header() that the same entry continues.
	 * Any other result, upstream's damaged-block ARCHIVE_RETRY
	 * included, ends the entry: the next call starts a new one.
	 */
	if (tar->nonblocking) {
		if (tar->header_would_block) {
			tar->header_would_block = 0;
			tar->header_deferring = 0;
			tar->header_offset = 0;
			tar->header_replay = 1;
			tar->entry_bytes_remaining = 0;
			tar->entry_padding = 0;
			gnu_clear_sparse_list(tar);
			a->read_header_in_progress = 1;
			return (ARCHIVE_RETRY);
		}
		tar_header_commit(a, tar);
		a->read_header_in_progress = 0;
	}
''')

# 4. read_data: resumable end-of-entry consume, retry propagation
rep('''			int64_t request = tar->entry_bytes_remaining +
			    tar->entry_padding;

			if (__archive_read_consume(a, request) != request)
				return (ARCHIVE_FATAL);
			tar->entry_padding = 0;
''', '''			int64_t request = tar->entry_bytes_remaining +
			    tar->entry_padding;

			/*
			 * BUN PATCH: make the end-of-entry padding
			 * consume resumable. `tar_consume_retryable`
			 * decrements `entry_bytes_remaining` /
			 * `entry_padding` as bytes become available so a
			 * subsequent call picks up with the remainder.
			 */
			int cr = tar_consume_retryable(a, tar, request);
			if (cr == ARCHIVE_RETRY)
				return (ARCHIVE_RETRY);
			if (cr != ARCHIVE_OK)
				return (ARCHIVE_FATAL);
			tar->entry_padding = 0;
			tar->entry_bytes_remaining = 0;
''')
rep('''		*buff = __archive_read_ahead(a, 1, &bytes_read);
		if (*buff == NULL) {
			archive_set_error(&a->archive, ARCHIVE_ERRNO_MISC,
			    "Truncated tar archive"
			    " detected while reading data");''', '''		*buff = __archive_read_ahead(a, 1, &bytes_read);
		if (*buff == NULL) {
			/*
			 * BUN PATCH: propagate non-blocking retry. Every
			 * counter we would have touched
			 * (`entry_bytes_remaining`, `sparse_list`, etc.)
			 * is still at its pre-call value, so the caller
			 * can yield and re-enter read_data_block later.
			 */
			if (bytes_read == ARCHIVE_RETRY)
				return (ARCHIVE_RETRY);
			archive_set_error(&a->archive, ARCHIVE_ERRNO_MISC,
			    "Truncated tar archive"
			    " detected while reading data");''')

# 5. skip
rep('''	struct tar *tar = a->format->data;
	int64_t request;

	request = tar->entry_bytes_remaining + tar->entry_padding +
	    tar->entry_bytes_unconsumed;

	if (__archive_read_consume(a, request) != request)
		return (ARCHIVE_FATAL);

	tar->entry_bytes_remaining = 0;
	tar->entry_bytes_unconsumed = 0;
	tar->entry_padding = 0;
''', '''	struct tar *tar = a->format->data;
	int64_t request;
	int cr;

	request = tar->entry_bytes_remaining + tar->entry_padding +
	    tar->entry_bytes_unconsumed;

	/*
	 * BUN PATCH: use the retryable consume so a non-blocking
	 * source can yield mid-skip. Progress is recorded in
	 * `entry_bytes_remaining` / `entry_padding` /
	 * `entry_bytes_unconsumed`, so archive_read_next_header's
	 * implicit skip on re-entry resumes with the remainder.
	 */
	tar->entry_bytes_unconsumed = 0;
	cr = tar_consume_retryable(a, tar, request);
	if (cr == ARCHIVE_RETRY)
		return (ARCHIVE_RETRY);
	if (cr != ARCHIVE_OK)
		return (ARCHIVE_FATAL);

	tar->entry_bytes_remaining = 0;
	tar->entry_padding = 0;
''')
# 6. a run of NULL blocks between archives needs no buffer
rep('''				if (tar->read_concatenated_archives) {
					/* We're ignoring NULL blocks, so keep going. */
					continue;
				}
''', '''				if (tar->read_concatenated_archives) {
					/* We're ignoring NULL blocks, so keep going. */
					/*
					 * BUN PATCH: nothing of this entry is
					 * parsed yet, so a replay can start
					 * after this block. A long run of
					 * NULL blocks then needs no buffer.
					 */
					if (seen_headers == 0 &&
					    tar_flush_unconsumed(a, unconsumed)
					    == ARCHIVE_OK)
						tar_header_checkpoint(a, tar);
					continue;
				}
''')
open(p, 'w').write(s)
print("applied")
