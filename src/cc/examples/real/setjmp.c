/* A recursive-descent calculator that reports syntax errors by longjmp from however deep
   the parser is, back to the entry point.

   Exports:
     int evaluate(const char *text, int *result);   0 on success, else 1 + the error offset
     int stress(void);                              runs a fixed set of inputs, returns a checksum

   `attempts` is volatile because it is modified between setjmp and longjmp and read after
   the longjmp; `base` is not modified in between, so it may be an ordinary variable. */
#include <setjmp.h>

struct parser {
    const char *text;
    int position;
    int depth;
    jmp_buf on_error;
};

static int parse_expression(struct parser *p);

static void fail(struct parser *p) {
    longjmp(p->on_error, 1 + p->position);
}

static void skip_spaces(struct parser *p) {
    while (p->text[p->position] == ' ')
        p->position++;
}

static int parse_number(struct parser *p) {
    skip_spaces(p);
    int c = p->text[p->position];
    if (c < '0' || c > '9')
        fail(p);
    int value = 0;
    while (c >= '0' && c <= '9') {
        value = value * 10 + (c - '0');
        c = p->text[++p->position];
    }
    return value;
}

static int parse_primary(struct parser *p) {
    skip_spaces(p);
    if (p->text[p->position] == '(') {
        p->position++;
        if (++p->depth > 64)
            fail(p);
        int value = parse_expression(p);
        skip_spaces(p);
        if (p->text[p->position] != ')')
            fail(p);
        p->position++;
        p->depth--;
        return value;
    }
    if (p->text[p->position] == '-') {
        p->position++;
        return -parse_primary(p);
    }
    return parse_number(p);
}

static int parse_term(struct parser *p) {
    int value = parse_primary(p);
    for (;;) {
        skip_spaces(p);
        char op = p->text[p->position];
        if (op != '*' && op != '/')
            return value;
        p->position++;
        int right = parse_primary(p);
        if (op == '/' && right == 0)
            fail(p);
        value = op == '*' ? value * right : value / right;
    }
}

static int parse_expression(struct parser *p) {
    int value = parse_term(p);
    for (;;) {
        skip_spaces(p);
        char op = p->text[p->position];
        if (op != '+' && op != '-')
            return value;
        p->position++;
        int right = parse_term(p);
        value = op == '+' ? value + right : value - right;
    }
}

int evaluate(const char *text, int *result) {
    struct parser p = { text, 0, 0 };
    int error = setjmp(p.on_error);
    if (error)
        return error;
    int value = parse_expression(&p);
    skip_spaces(&p);
    if (p.text[p.position] != '\0')
        fail(&p);
    *result = value;
    return 0;
}

/* Retries with the broken character patched out, counting the attempts. */
int stress(void) {
    static const char *const inputs[] = {
        "1 + 2 * 3",
        "(1 + 2) * (3 + 4)",
        "((((5))))",
        "2 * (3 + ",          /* error at the end, three frames deep */
        "10 / (5 - 5)",       /* division by zero inside parentheses */
        "7 + * 2",
        "-(-(-4)) * 2",
    };
    volatile int attempts = 0;
    int base = 1000;
    int checksum = 0;
    for (int i = 0; i < (int)(sizeof inputs / sizeof inputs[0]); i++) {
        int result = 0;
        attempts = attempts + 1;
        int error = evaluate(inputs[i], &result);
        checksum = checksum * 31 + (error ? -error : result) + base;
    }
    return checksum + attempts;
}
