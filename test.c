//#include <stdio.h>
#include <sys/resource.h>

int main() {
    int r = getpriority(0, 4);
    //printf("asd %d", r);
    return 0;
}