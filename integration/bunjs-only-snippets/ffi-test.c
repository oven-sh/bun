#include <stdbool.h>
#include <stdint.h>

char identity_char(char a);
int8_t identity_int8_t(int8_t a);
uint8_t identity_uint8_t(uint8_t a);
int16_t identity_int16_t(int16_t a);
uint16_t identity_uint16_t(uint16_t a);
int32_t identity_int32_t(int32_t a);
uint32_t identity_uint32_t(uint32_t a);
int64_t identity_int64_t(int64_t a);
uint64_t identity_uint64_t(uint64_t a);
double identity_double(double a);
float identity_float(float a);

char add_char(char a, char b);
int8_t add_int8_t(int8_t a, int8_t b);
uint8_t add_uint8_t(uint8_t a, uint8_t b);
int16_t add_int16_t(int16_t a, int16_t b);
uint16_t add_uint16_t(uint16_t a, uint16_t b);
int32_t add_int32_t(int32_t a, int32_t b);
uint32_t add_uint32_t(uint32_t a, uint32_t b);
int64_t add_int64_t(int64_t a, int64_t b);
uint64_t add_uint64_t(uint64_t a, uint64_t b);
double add_double(double a, double b);
float add_float(float a, float b);

char identity_char(char a) { return a; }
int8_t identity_int8_t(int8_t a) { return a; }
uint8_t identity_uint8_t(uint8_t a) { return a; }
int16_t identity_int16_t(int16_t a) { return a; }
uint16_t identity_uint16_t(uint16_t a) { return a; }
int32_t identity_int32_t(int32_t a) { return a; }
uint32_t identity_uint32_t(uint32_t a) { return a; }
int64_t identity_int64_t(int64_t a) { return a; }
uint64_t identity_uint64_t(uint64_t a) { return a; }
double identity_double(double a) { return a; }
float identity_float(float a) { return a; }

char add_char(char a, char b) { return a + b; }
int8_t add_int8_t(int8_t a, int8_t b) { return a + b; }
uint8_t add_uint8_t(uint8_t a, uint8_t b) { return a + b; }
int16_t add_int16_t(int16_t a, int16_t b) { return a + b; }
uint16_t add_uint16_t(uint16_t a, uint16_t b) { return a + b; }
int32_t add_int32_t(int32_t a, int32_t b) { return a + b; }
uint32_t add_uint32_t(uint32_t a, uint32_t b) { return a + b; }
int64_t add_int64_t(int64_t a, int64_t b) { return a + b; }
uint64_t add_uint64_t(uint64_t a, uint64_t b) { return a + b; }
double add_double(double a, double b) { return a + b; }
float add_float(float a, float b) { return a + b; }
