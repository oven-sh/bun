#include <arpa/inet.h>
#include <ifaddrs.h>
#include <stdio.h>
#include <netdb.h>
#include "interface_addresses.h"

int main()
{
    
    /*struct ifaddrs *ifap, *ifa;
    struct in6_addr in6addr;

    getifaddrs (&ifap);
    for (ifa = ifap; ifa; ifa = ifa->ifa_next) {
        if (ifa->ifa_addr && ifa->ifa_addr->sa_family==AF_INET) {
            struct sockaddr_in *sa = (struct sockaddr_in *) ifa->ifa_addr;
            char *addr = inet_ntoa(sa->sin_addr);
            printf("Family: IPv4 | Interface: %s | Address: %s\n", ifa->ifa_name, addr);
        } else if (ifa->ifa_addr && ifa->ifa_addr->sa_family==AF_INET6) {
            struct sockaddr_in6 *sa = (struct sockaddr_in6 *) ifa->ifa_addr;
            char addr[INET6_ADDRSTRLEN];
            inet_ntop(AF_INET6, &in6addr, addr, sizeof(addr));
            printf("Family: IPv6 | Interface: %s | Address: %s\n", ifa->ifa_name, addr);
        }
    }

    freeifaddrs(ifap);*/
    NetworkInterface* arr = getNetworkInterfaces();
    int arrLength = getNetworkInterfaceArrayLen(arr);

    for (int i = 0; i < arrLength; i++) {
        printf("Interface: %s | Address: %s | Family: %s\n", arr[i].interface, arr[i].address, arr[i].family);
    }

    return 0;
}
