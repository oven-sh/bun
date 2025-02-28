#ifndef __US_SAFETY_H__
#define __US_SAFETY_H__


#if (defined(ASSERT) && ASSERT) || (defined(ASSERT_ENABLED) && ASSERT_ENABLED)

#ifdef NDEBUG
#undef NDEBUG
#endif

#include <assert.h>

/**
 * Ownership of this pointer has been transferred elsewhere. This pointer is no
 * longer usable.
 */
#define MOVED(ptr) ptr = NULL

#else

#ifndef NDEBUG
#define NDEBUG
#endif

#include <assert.h>

/*
 * Ownership of this pointer has been transferred elsewhere. This pointer is no
 * longer usable.
 */
#define MOVED(ptr)

#endif // ASSERT

#endif // __US_SAFETY_H__
