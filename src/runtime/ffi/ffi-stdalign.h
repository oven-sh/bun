#ifndef _STDALIGN_H
#define _STDALIGN_H

#if __STDC_VERSION__ < 201112L && (defined(__GNUC__) || defined(__TINYC__))
#define _Alignas(t) __attribute__((__aligned__(t)))
#define _Alignof(t) __alignof__(t)
#endif

#define alignas _Alignas
#define alignof _Alignof

#define __alignas_is_defined 1
#define __alignof_is_defined 1

#endif /* _STDALIGN_H */
