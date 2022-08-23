#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/types.h>
#include <sys/socket.h>
#include <ifaddrs.h>
#ifdef __linux__
    #include <arpa/inet.h>
    #include <netpacket/packet.h>
    #include <net/ethernet.h>
#else
    #include <net/if_dl.h>
#endif

#include "interface_addresses.h"

NetworkInterface *getNetworkInterfaces() {
    NetworkInterface *interfaces = (NetworkInterface*) malloc(sizeof(NetworkInterface));
    if (interfaces == NULL) return NULL;

    short interfacesIndex = -1;
    struct ifaddrs *ifap, *ifa;

    getifaddrs (&ifap);
    for (ifa = ifap; ifa; ifa = ifa->ifa_next) {
        if (ifa->ifa_addr && ifa->ifa_addr->sa_family==AF_INET) {
            struct sockaddr_in *sa = (struct sockaddr_in *) ifa->ifa_addr;
            char addr[INET_ADDRSTRLEN];
            inet_ntop(AF_INET, &(sa->sin_addr), addr, sizeof(addr));
            char netmask[INET_ADDRSTRLEN];
            inet_ntop(AF_INET, &(((struct sockaddr_in *) ifa->ifa_netmask)->sin_addr), netmask, sizeof(netmask));
            char *interface_name = ifa->ifa_name;

            interfacesIndex++;
            if (interfacesIndex > 0)  {
                interfaces = (NetworkInterface*) realloc(interfaces, (interfacesIndex+1) * sizeof(NetworkInterface));
                if (interfaces == NULL) return NULL;
            }

            interfaces[interfacesIndex].address = (char*) malloc(strlen(addr)+1);
            if (interfaces[interfacesIndex].address == NULL) return NULL;
            memcpy(interfaces[interfacesIndex].address, addr, strlen(addr));
            interfaces[interfacesIndex].address[strlen(addr)] = '\0';

            interfaces[interfacesIndex].netmask = (char*) malloc(strlen(netmask)+1);
            if (interfaces[interfacesIndex].netmask == NULL) return NULL;
            memcpy(interfaces[interfacesIndex].netmask, netmask, strlen(netmask));
            interfaces[interfacesIndex].netmask[strlen(netmask)] = '\0';

            interfaces[interfacesIndex].interface = (char*) malloc(strlen(interface_name)+1);
            if (interfaces[interfacesIndex].interface == NULL) return NULL;
            memcpy(interfaces[interfacesIndex].interface, interface_name, strlen(interface_name));
            interfaces[interfacesIndex].interface[strlen(interface_name)] = '\0';

            interfaces[interfacesIndex].family = (char*) malloc(strlen("IPv4")+1);
            memcpy(interfaces[interfacesIndex].family, "IPv4", strlen("IPv4"));
            interfaces[interfacesIndex].family[strlen("IPv4")] = '\0';

            interfaces[interfacesIndex].internal = !!(ifa->ifa_flags & 0x8);
        } else if (ifa->ifa_addr && ifa->ifa_addr->sa_family==AF_INET6) {
            struct sockaddr_in6 *sa = (struct sockaddr_in6 *) ifa->ifa_addr;
            char addr[INET6_ADDRSTRLEN];
            inet_ntop(AF_INET6, &(sa->sin6_addr), addr, sizeof(addr));
            char netmask[INET6_ADDRSTRLEN];
            inet_ntop(AF_INET6, &(((struct sockaddr_in6 *) ifa->ifa_netmask)->sin6_addr), netmask, sizeof(netmask));
            char *interface_name = ifa->ifa_name;

            interfacesIndex++;
            if (interfacesIndex > 0)  {
                interfaces = (NetworkInterface*) realloc(interfaces, (interfacesIndex+1) * sizeof(NetworkInterface));
                if (interfaces == NULL) return NULL;
            }

            interfaces[interfacesIndex].address = (char*) malloc(strlen(addr)+1);
            if (interfaces[interfacesIndex].address == NULL) return NULL;
            memcpy(interfaces[interfacesIndex].address, addr, strlen(addr));
            interfaces[interfacesIndex].address[strlen(addr)] = '\0';

            interfaces[interfacesIndex].netmask = (char*) malloc(strlen(netmask)+1);
            if (interfaces[interfacesIndex].netmask == NULL) return NULL;
            memcpy(interfaces[interfacesIndex].netmask, netmask, strlen(netmask));
            interfaces[interfacesIndex].netmask[strlen(netmask)] = '\0';

            interfaces[interfacesIndex].interface = (char*) malloc(strlen(interface_name)+1);
            if (interfaces[interfacesIndex].interface == NULL) return NULL;
            memcpy(interfaces[interfacesIndex].interface, interface_name, strlen(interface_name));
            interfaces[interfacesIndex].interface[strlen(interface_name)] = '\0';

            interfaces[interfacesIndex].family = (char*) malloc(strlen("IPv6")+1);
            memcpy(interfaces[interfacesIndex].family, "IPv6", strlen("IPv6"));
            interfaces[interfacesIndex].family[strlen("IPv6")] = '\0';

            interfaces[interfacesIndex].internal = !!(ifa->ifa_flags & 0x8);
        } 
    }

    interfacesIndex++;
    interfaces = (NetworkInterface*) realloc(interfaces, (interfacesIndex+1) * sizeof(NetworkInterface));
    if (interfaces == NULL) return NULL;
    interfaces[interfacesIndex] = (NetworkInterface) {NULL, NULL, NULL, NULL, NULL, 0};

    for (ifa = ifap; ifa; ifa = ifa->ifa_next) {
        #ifdef __linux__
        if (ifa->ifa_addr && ifa->ifa_addr->sa_family==AF_PACKET) {
            char macp[INET6_ADDRSTRLEN];
            struct sockaddr_ll *s = (struct sockaddr_ll *) ifa->ifa_addr;
            int i;
            int len = 0;

            for (i = 0; i < 6; i++) {
                len += sprintf(macp+len, "%02X%s", s->sll_addr[i], i < 5 ? ":":"");
            }

            i = 0;

            int arrLength = getNetworkInterfaceArrayLen(interfaces);

            for (; i < arrLength; i++) {
                if (strcmp(interfaces[i].interface, (ifa)->ifa_name) == 0) {
                    interfaces[i].mac = (char*) malloc(strlen(macp)+1);
                    memcpy(interfaces[i].mac, macp, strlen(macp));
                    interfaces[i].mac[strlen(macp)] = '\0';
                }
            }
        }
        #else
        if (ifa->ifa_addr && ifa->ifa_addr->sa_family==AF_LINK) {
            char macp[18];
            struct sockaddr_ll *s = (struct sockaddr_dl *) ifa->ifa_addr;
            ptr = (unsigned char *)LLADDR(s);
            sprintf(macp, "%02x:%02x:%02x:%02x:%02x:%02x", *ptr, *(ptr+1), *(ptr+2), *(ptr+3), *(ptr+4), *(ptr+5));

            int arrLength = getNetworkInterfaceArrayLen(interfaces);
            for (int i = 0; i < arrLength; i++) {
                if (strcmp(interfaces[i].interface, (ifa)->ifa_name) == 0) {
                    interfaces[i].mac = (char*) malloc(strlen(macp)+1);
                    memcpy(interfaces[i].mac, macp, strlen(macp));
                    interfaces[i].mac[strlen(macp)] = '\0';
                }
            }
        }
        #endif
    }

    freeifaddrs(ifap);

    return interfaces;
}

int getNetworkInterfaceArrayLen(NetworkInterface *arr) {
    int i = 0;
    for (; arr[i].address != NULL; i++);
    return i;
}

char **getNetworkInterfaceNames() {
    char **interfaces = (char**) malloc(sizeof(char*));
    if (interfaces == NULL) return NULL;

    short interfacesIndex = -1;
    struct ifaddrs *ifap, *ifa;

    getifaddrs (&ifap);
    for (ifa = ifap; ifa; ifa = ifa->ifa_next) {
        if (ifa->ifa_addr && ifa->ifa_addr->sa_family==AF_INET) {
            char *interface_name = ifa->ifa_name;

            interfacesIndex++;
            if (interfacesIndex > 0)  {
                interfaces = (char**) realloc(interfaces, (interfacesIndex+1) * sizeof(char*));
                if (interfaces == NULL) return NULL;
            }

            interfaces[interfacesIndex] = (char*) malloc(strlen(interface_name)+1);
            if (interfaces[interfacesIndex] == NULL) return NULL;
            memcpy(interfaces[interfacesIndex], interface_name, strlen(interface_name));
            interfaces[interfacesIndex][strlen(interface_name)] = '\0';
        } else if (ifa->ifa_addr && ifa->ifa_addr->sa_family==AF_INET6) {
            char *interface_name = ifa->ifa_name;

            interfacesIndex++;
            if (interfacesIndex > 0)  {
                interfaces = (char**) realloc(interfaces, (interfacesIndex+1) * sizeof(char*));
                if (interfaces == NULL) return NULL;
            }

            interfaces[interfacesIndex] = (char*) malloc(strlen(interface_name)+1);
            if (interfaces[interfacesIndex] == NULL) return NULL;
            memcpy(interfaces[interfacesIndex], interface_name, strlen(interface_name));
            interfaces[interfacesIndex][strlen(interface_name)] = '\0';
        } 
    }

    interfacesIndex++;
    interfaces = (char**) realloc(interfaces, (interfacesIndex+1) * sizeof(char*));
    if (interfaces == NULL) return NULL;
    interfaces[interfacesIndex] = (char*) {NULL};

    freeifaddrs(ifap);

    return interfaces;
}

int getNetworkInterfaceNameArrayLen(char **arr) {
    int i = 0;
    for (; arr[i] != NULL; i++);
    return i;
}