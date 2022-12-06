
// only on linux
#ifdef __linux__

__asm__(".symver exp,exp at GLIBC_2.17");
__asm__(".symver exp2,exp2 at GLIBC_2.17");
__asm__(".symver exp2f,exp2f at GLIBC_2.17");
__asm__(".symver expf,expf at GLIBC_2.17");
__asm__(".symver fcntl64,fcntl64 at GLIBC_2.17");
__asm__(".symver getrandom,getrandom at GLIBC_2.17");
__asm__(".symver log,log at GLIBC_2.17");
__asm__(".symver log2,log2 at GLIBC_2.17");
__asm__(".symver log2f,log2f at GLIBC_2.17");
__asm__(".symver logf,logf at GLIBC_2.17");
__asm__(".symver pow,pow at GLIBC_2.17");
__asm__(".symver powf,powf at GLIBC_2.17");

#endif