#define EMPTY
#define f(a) a*g
#define g(a) f(a)
f(2)(9)
#define AA BB
#define BB AA
AA BB
#define foo foo + bar
#define bar foo
foo bar
#define x 3
#define F(a) F(x * (a))
#undef x
#define x 2
#define G F
#define z z[0]
#define hh G(~
#define m(a) a(w)
#define w 0,1
#define t(a) a
#define p() int
#define q(x) x
#define r(x,y) x ## y
#define str(x) # x
F(y+1) + F(F(z)) % t(t(G)(0) + t)(1);
G(x+(3,4)-w) | hh 5) & m
(F)^m(m);
p() i[q()] = { q(1), r(2,3), r(4,), r(,5), r(,) };
char c[2][6] = { str(hello), str() };
#define xstr(s) str(s)
#define debug(s, t) printf("x" # s "= %d, x" # t "= %s", \
 x ## s, x ## t)
#define INCFILE(n) vers ## n
#define glue(a, b) a ## b
#define xglue(a, b) glue(a, b)
#define HIGHLOW "hello"
#define LOW LOW ", world"
debug(1, 2);
fputs(str(strncmp("abc\0d", "abc", '\4') // this goes away
 == 0) str(: @\n), s);
xstr(INCFILE(2).h)
glue(HIGH, LOW);
xglue(HIGH, LOW)
#define hash_hash # ## #
#define mkstr(a) # a
#define in_between(a) mkstr(a)
#define join(c, d) in_between(c hash_hash d)
char p2[] = join(x, y);
#define t2(x,y,z) x ## y ## z
int j[] = { t2(1,2,3), t2(,4,5), t2(6,,7), t2(8,9,),
 t2(10,,), t2(,11,), t2(,,12), t2(,,) };
#define OBJ_LIKE (1-1)
#define OBJ_LIKE /* white space */ (1-1) /* other */
#define FUNC_LIKE(a) ( a )
#define FUNC_LIKE( a )( /* note the white space */ \
 a /* other stuff on this line
 */ )
#define debug2(...) fprintf(stderr, __VA_ARGS__)
#define showlist(...) puts(#__VA_ARGS__)
#define report(test, ...) ((test)?puts(#test):\
 printf(__VA_ARGS__))
debug2("Flag");
debug2("X = %d\n", x);
showlist(The first, second, and third items.);
report(x>y, "x is %d but y is %d", x, y);
#define eprintf(format, args...) fprintf(stderr, format , ## args)
eprintf("a") eprintf("b %d", 1) 
#define eprintf2(format, ...) fprintf(stderr, format , ## __VA_ARGS__)
eprintf2("a") eprintf2("b %d", 1, 2)
#define CAT(a, ...) PRIMITIVE_CAT(a, __VA_ARGS__)
#define PRIMITIVE_CAT(a, ...) a ## __VA_ARGS__
#define DEFER(id) id EMPTY2()
#define EMPTY2()
#define OBSTRUCT(...) __VA_ARGS__ DEFER(EMPTY2)()
#define EXPAND(...) __VA_ARGS__
#define EVAL(...)  EVAL1(EVAL1(EVAL1(__VA_ARGS__)))
#define EVAL1(...) EVAL2(EVAL2(EVAL2(__VA_ARGS__)))
#define EVAL2(...) __VA_ARGS__
#define A() 123
A () DEFER(A)() EXPAND(DEFER(A)())
#define DEC(x) PRIMITIVE_CAT(DEC_, x)
#define DEC_0 0
#define DEC_1 0
#define DEC_2 1
#define DEC_3 2
#define IIF(c) PRIMITIVE_CAT(IIF_, c)
#define IIF_0(t, ...) __VA_ARGS__
#define IIF_1(t, ...) t
#define CHECK_N(x, n, ...) n
#define CHECK(...) CHECK_N(__VA_ARGS__, 0,)
#define PROBE(x) x, 1,
#define NOT(x) CHECK(PRIMITIVE_CAT(NOT_, x))
#define NOT_0 PROBE(~)
#define COMPL(b) PRIMITIVE_CAT(COMPL_, b)
#define COMPL_0 1
#define COMPL_1 0
#define BOOL(x) COMPL(NOT(x))
#define IF(c) IIF(BOOL(c))
#define EAT(...)
#define WHEN(c) IF(c)(EXPAND, EAT)
#define REPEAT(count, macro, ...) \
    WHEN(count) \
    ( \
        OBSTRUCT(REPEAT_INDIRECT) () \
        ( \
            DEC(count), macro, __VA_ARGS__ \
        ) \
        OBSTRUCT(macro) \
        ( \
            DEC(count), __VA_ARGS__ \
        ) \
    )
#define REPEAT_INDIRECT() REPEAT
#define M(i, _) i
EVAL(REPEAT(3, M, ~))
NOT(0) NOT(1) BOOL(3) IF(1)(yes,no) IF(0)(yes,no)
#define LPAREN (
#define RPAREN )
#define FX(x, y) x + y
#define ELLIP_FUNC(...) __VA_ARGS__
ELLIP_FUNC(FX, LPAREN, 'a', 'b', RPAREN);
#define SELF SELF
#define SELF2(x) SELF2(x) SELF
SELF SELF2(SELF2(1))
#define NOARGS nothing
NOARGS (1)
#define FL(x) [x]
FL
(1) FL FL(FL)(2)
#define STR2(...) #__VA_ARGS__
STR2(  a  ,  "b\n" ,'\'',  c  ) STR2() STR2( "\\" )
__LINE__ __INCLUDE_LEVEL__ __COUNTER__ __COUNTER__
#define LINE __LINE__
LINE
#if defined(EMPTY) && !defined NOPE && (1 ? 2 : (1/0)) && -1 < 0u == 0 && 'a' == 97 && (2 || 1/0)
ok1
#endif
#define DEF defined(EMPTY)
#if DEF && 0x10 == 16 && 010 == 8 && (-1 >> 1) < 0 && 1 << 2 == 4 && UNDEFINED == 0
ok2
#else
bad2
#endif
#if 0
#error don't
'unterminated
# bogus directive
#elif 1
ok3
#else
#error no
#endif
#ifdef __has_include
#if __has_include(<stddef.h>) && !__has_include("nonexistent_file.h") && __has_builtin(__builtin_expect) && !__has_attribute(zzz)
ok4
#endif
#endif
